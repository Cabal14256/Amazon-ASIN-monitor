const fs = require('fs');
const path = require('path');
const mainDatabase = require('../config/database');
const competitorDatabase = require('../config/competitor-database');
const logger = require('../utils/logger');

const MAX_REPORTED_DIFFERENCES = 20;
const OPERATIONAL_TABLE_PATTERNS = [/_bak_/i, /^op_/i];
const SCHEMA_TARGETS = {
  main: {
    initPath: path.join(__dirname, '../../database/init.sql'),
    database: mainDatabase,
  },
  competitor: {
    initPath: path.join(__dirname, '../../database/competitor-init.sql'),
    database: competitorDatabase,
  },
};

let cachedAudit = {
  status: 'unknown',
  checkedAt: null,
  main: { status: 'unknown', differenceCount: 0, differences: [] },
  competitor: { status: 'unknown', differenceCount: 0, differences: [] },
};

function normalizeWhitespace(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ',')
    .toLowerCase();
}

function normalizeDefault(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).replace(/^'|'$/g, '');
  if (normalized.toUpperCase() === 'NULL') return null;
  if (/^CURRENT_TIMESTAMP(?:\(\))?$/i.test(normalized)) {
    return 'CURRENT_TIMESTAMP';
  }
  return normalized;
}

function unquoteIdentifier(value) {
  return String(value || '')
    .trim()
    .replace(/^`|`$/g, '');
}

function parseIdentifierList(value) {
  return String(value || '')
    .split(',')
    .map((item) => unquoteIdentifier(item.replace(/\s+(ASC|DESC)$/i, '')))
    .filter(Boolean);
}

function splitTopLevelDefinitions(body) {
  const definitions = [];
  let current = '';
  let depth = 0;
  let quote = null;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    const next = body[index + 1];

    if (quote) {
      current += char;
      if (char === quote) {
        if (next === quote) {
          current += next;
          index += 1;
        } else if (body[index - 1] !== '\\') {
          quote = null;
        }
      }
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      current += char;
    } else if (char === '(') {
      depth += 1;
      current += char;
    } else if (char === ')') {
      depth -= 1;
      current += char;
    } else if (char === ',' && depth === 0) {
      if (current.trim()) definitions.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) definitions.push(current.trim());
  return definitions;
}

function readColumnType(definition) {
  let depth = 0;
  let quote = null;
  for (let index = 0; index < definition.length; index += 1) {
    const char = definition[index];
    if (quote) {
      if (char === quote && definition[index - 1] !== '\\') quote = null;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (/\s/.test(char) && depth === 0) {
      return {
        endIndex: index,
        type: normalizeWhitespace(definition.slice(0, index)),
      };
    }
  }
  return {
    endIndex: definition.length,
    type: normalizeWhitespace(definition),
  };
}

function parseColumnDefinition(definition) {
  const match = definition.match(/^`([^`]+)`\s+([\s\S]+)$/);
  if (!match) return null;

  const [, name, remainder] = match;
  const { endIndex, type } = readColumnType(remainder);
  const options = remainder.slice(endIndex);
  const defaultMatch = options.match(
    /\bDEFAULT\s+(NULL|CURRENT_TIMESTAMP(?:\(\))?|'(?:''|[^'])*'|[^\s,]+)/i,
  );

  return {
    name,
    type,
    nullable: /\bNOT NULL\b/i.test(options) ? 'NO' : 'YES',
    default: defaultMatch ? normalizeDefault(defaultMatch[1]) : null,
    autoIncrement: /\bAUTO_INCREMENT\b/i.test(options),
    generated: /\bGENERATED\s+ALWAYS\b/i.test(options),
    onUpdate: /\bON\s+UPDATE\s+CURRENT_TIMESTAMP/i.test(options),
    inlinePrimary: /\bPRIMARY\s+KEY\b/i.test(options),
    inlineUnique: /\bUNIQUE\b/i.test(options),
  };
}

function buildIndexSignature(kind, columns) {
  return `${kind}:${columns.join(',')}`;
}

function parseInitSchema(sql) {
  const databaseMatch = sql.match(
    /CREATE DATABASE IF NOT EXISTS\s+`([^`]+)`[\s\S]*?COLLATE\s+([^;\s]+)/i,
  );
  if (!databaseMatch) {
    throw new Error('初始化SQL缺少数据库名称或排序规则');
  }

  const schema = {
    databaseName: databaseMatch[1],
    collation: databaseMatch[2],
    tables: new Map(),
  };
  const tablePattern =
    /CREATE TABLE IF NOT EXISTS\s+`([^`]+)`\s*\(([\s\S]*?)\)\s*ENGINE=([^\s]+)\s+DEFAULT CHARSET=([^\s]+)(?:\s+COLLATE=([^\s]+))?/gi;

  for (const tableMatch of sql.matchAll(tablePattern)) {
    const [, tableName, body, engine, charset, explicitCollation] = tableMatch;
    const table = {
      name: tableName,
      engine,
      charset,
      collation: explicitCollation || schema.collation,
      columns: new Map(),
      indexes: [],
      foreignKeys: [],
    };
    const primaryColumns = new Set();

    for (const definition of splitTopLevelDefinitions(body)) {
      const column = parseColumnDefinition(definition);
      if (column) {
        table.columns.set(column.name, column);
        if (column.inlinePrimary) primaryColumns.add(column.name);
        if (column.inlinePrimary) {
          table.indexes.push({ kind: 'primary', columns: [column.name] });
        } else if (column.inlineUnique) {
          table.indexes.push({ kind: 'unique', columns: [column.name] });
        }
        continue;
      }

      const primaryMatch = definition.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i);
      if (primaryMatch) {
        const columns = parseIdentifierList(primaryMatch[1]);
        columns.forEach((name) => primaryColumns.add(name));
        table.indexes.push({ kind: 'primary', columns });
        continue;
      }

      const indexMatch = definition.match(
        /^(UNIQUE\s+)?(?:INDEX|KEY)(?:\s+`[^`]+`)?\s*\(([^)]+)\)/i,
      );
      if (indexMatch) {
        table.indexes.push({
          kind: indexMatch[1] ? 'unique' : 'index',
          columns: parseIdentifierList(indexMatch[2]),
        });
        continue;
      }

      const foreignKeyMatch = definition.match(
        /FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+`?([^`\s(]+)`?\s*\(([^)]+)\)(?:\s+ON DELETE\s+(CASCADE|SET NULL|RESTRICT|NO ACTION))?(?:\s+ON UPDATE\s+(CASCADE|SET NULL|RESTRICT|NO ACTION))?/i,
      );
      if (foreignKeyMatch) {
        table.foreignKeys.push({
          columns: parseIdentifierList(foreignKeyMatch[1]),
          referencedTable: foreignKeyMatch[2],
          referencedColumns: parseIdentifierList(foreignKeyMatch[3]),
          deleteRule: (foreignKeyMatch[4] || 'NO ACTION').toUpperCase(),
          updateRule: (foreignKeyMatch[5] || 'NO ACTION').toUpperCase(),
        });
      }
    }

    primaryColumns.forEach((name) => {
      const column = table.columns.get(name);
      if (column) column.nullable = 'NO';
    });
    schema.tables.set(tableName, table);
  }

  return schema;
}

function isOperationalTable(tableName) {
  return OPERATIONAL_TABLE_PATTERNS.some((pattern) => pattern.test(tableName));
}

function addDifference(differences, kind, table, name, expected, actual) {
  differences.push({ kind, table, name, expected, actual });
}

function countSignatures(items, signatureBuilder) {
  const counts = new Map();
  items.forEach((item) => {
    const signature = signatureBuilder(item);
    counts.set(signature, (counts.get(signature) || 0) + 1);
  });
  return counts;
}

function compareSignatureCounts(
  differences,
  kind,
  tableName,
  expectedItems,
  actualItems,
  signatureBuilder,
) {
  const expectedCounts = countSignatures(expectedItems, signatureBuilder);
  const actualCounts = countSignatures(actualItems, signatureBuilder);
  const signatures = new Set([
    ...expectedCounts.keys(),
    ...actualCounts.keys(),
  ]);
  signatures.forEach((signature) => {
    const expected = expectedCounts.get(signature) || 0;
    const actual = actualCounts.get(signature) || 0;
    if (expected !== actual) {
      addDifference(differences, kind, tableName, signature, expected, actual);
    }
  });
}

async function loadActualSchema(query) {
  const [databaseRows, tableRows, columnRows, indexRows, foreignKeyRows] =
    await Promise.all([
      query(
        `SELECT DATABASE() AS database_name,
                DEFAULT_COLLATION_NAME AS collation
         FROM information_schema.SCHEMATA
         WHERE SCHEMA_NAME = DATABASE()`,
      ),
      query(
        `SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`,
      ),
      query(
        `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE,
                COLUMN_DEFAULT, EXTRA
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
         ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      ),
      query(
        `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
         ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
      ),
      query(
        `SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME,
                k.ORDINAL_POSITION, k.REFERENCED_TABLE_NAME,
                k.REFERENCED_COLUMN_NAME, r.DELETE_RULE, r.UPDATE_RULE
         FROM information_schema.KEY_COLUMN_USAGE k
         JOIN information_schema.REFERENTIAL_CONSTRAINTS r
           ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
          AND r.TABLE_NAME = k.TABLE_NAME
          AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
         WHERE k.CONSTRAINT_SCHEMA = DATABASE()
           AND k.REFERENCED_TABLE_NAME IS NOT NULL
         ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
      ),
    ]);

  const actual = {
    databaseName: databaseRows[0]?.database_name || null,
    collation: databaseRows[0]?.collation || null,
    tables: new Map(),
  };

  tableRows.forEach((row) => {
    actual.tables.set(row.TABLE_NAME, {
      name: row.TABLE_NAME,
      engine: row.ENGINE,
      collation: row.TABLE_COLLATION,
      columns: new Map(),
      indexes: [],
      foreignKeys: [],
    });
  });
  columnRows.forEach((row) => {
    const table = actual.tables.get(row.TABLE_NAME);
    if (!table) return;
    const extra = String(row.EXTRA || '').toLowerCase();
    table.columns.set(row.COLUMN_NAME, {
      name: row.COLUMN_NAME,
      type: normalizeWhitespace(row.COLUMN_TYPE),
      nullable: row.IS_NULLABLE,
      default: normalizeDefault(row.COLUMN_DEFAULT),
      autoIncrement: extra.includes('auto_increment'),
      generated:
        extra.includes('virtual generated') ||
        extra.includes('stored generated'),
      onUpdate: extra.includes('on update'),
    });
  });

  const indexes = new Map();
  indexRows.forEach((row) => {
    const key = `${row.TABLE_NAME}:${row.INDEX_NAME}`;
    if (!indexes.has(key)) {
      indexes.set(key, {
        tableName: row.TABLE_NAME,
        kind:
          row.INDEX_NAME === 'PRIMARY'
            ? 'primary'
            : Number(row.NON_UNIQUE) === 0
            ? 'unique'
            : 'index',
        columns: [],
      });
    }
    indexes.get(key).columns.push(row.COLUMN_NAME);
  });
  indexes.forEach((index) => {
    actual.tables.get(index.tableName)?.indexes.push(index);
  });

  const foreignKeys = new Map();
  foreignKeyRows.forEach((row) => {
    const key = `${row.TABLE_NAME}:${row.CONSTRAINT_NAME}`;
    if (!foreignKeys.has(key)) {
      foreignKeys.set(key, {
        tableName: row.TABLE_NAME,
        columns: [],
        referencedTable: row.REFERENCED_TABLE_NAME,
        referencedColumns: [],
        deleteRule: row.DELETE_RULE,
        updateRule: row.UPDATE_RULE,
      });
    }
    const foreignKey = foreignKeys.get(key);
    foreignKey.columns.push(row.COLUMN_NAME);
    foreignKey.referencedColumns.push(row.REFERENCED_COLUMN_NAME);
  });
  foreignKeys.forEach((foreignKey) => {
    actual.tables.get(foreignKey.tableName)?.foreignKeys.push(foreignKey);
  });

  return actual;
}

function compareSchemas(expected, actual) {
  const differences = [];
  if (expected.collation !== actual.collation) {
    addDifference(
      differences,
      'database_collation',
      null,
      expected.databaseName,
      expected.collation,
      actual.collation,
    );
  }

  expected.tables.forEach((expectedTable, tableName) => {
    const actualTable = actual.tables.get(tableName);
    if (!actualTable) {
      addDifference(
        differences,
        'missing_table',
        tableName,
        tableName,
        true,
        false,
      );
      return;
    }
    if (
      normalizeWhitespace(expectedTable.engine) !==
      normalizeWhitespace(actualTable.engine)
    ) {
      addDifference(
        differences,
        'table_engine',
        tableName,
        tableName,
        expectedTable.engine,
        actualTable.engine,
      );
    }
    if (expectedTable.collation !== actualTable.collation) {
      addDifference(
        differences,
        'table_collation',
        tableName,
        tableName,
        expectedTable.collation,
        actualTable.collation,
      );
    }

    expectedTable.columns.forEach((expectedColumn, columnName) => {
      const actualColumn = actualTable.columns.get(columnName);
      if (!actualColumn) {
        addDifference(
          differences,
          'missing_column',
          tableName,
          columnName,
          true,
          false,
        );
        return;
      }
      for (const property of [
        'type',
        'nullable',
        'default',
        'autoIncrement',
        'generated',
        'onUpdate',
      ]) {
        if (expectedColumn[property] !== actualColumn[property]) {
          addDifference(
            differences,
            `column_${property}`,
            tableName,
            columnName,
            expectedColumn[property],
            actualColumn[property],
          );
        }
      }
    });
    actualTable.columns.forEach((_, columnName) => {
      if (!expectedTable.columns.has(columnName)) {
        addDifference(
          differences,
          'extra_column',
          tableName,
          columnName,
          false,
          true,
        );
      }
    });

    compareSignatureCounts(
      differences,
      'index_signature',
      tableName,
      expectedTable.indexes,
      actualTable.indexes,
      (index) => buildIndexSignature(index.kind, index.columns),
    );
    compareSignatureCounts(
      differences,
      'foreign_key_signature',
      tableName,
      expectedTable.foreignKeys,
      actualTable.foreignKeys,
      (foreignKey) =>
        `${foreignKey.columns.join(',')}->${
          foreignKey.referencedTable
        }(${foreignKey.referencedColumns.join(',')}):${foreignKey.deleteRule}:${
          foreignKey.updateRule
        }`,
    );
  });

  actual.tables.forEach((_, tableName) => {
    if (!expected.tables.has(tableName) && !isOperationalTable(tableName)) {
      addDifference(
        differences,
        'extra_table',
        tableName,
        tableName,
        false,
        true,
      );
    }
  });
  return differences;
}

async function auditTarget(target, queryOverride) {
  const config = SCHEMA_TARGETS[target];
  if (!config) throw new Error(`不支持的schema审计目标: ${target}`);
  try {
    const expected = parseInitSchema(fs.readFileSync(config.initPath, 'utf8'));
    const actual = await loadActualSchema(
      queryOverride || config.database.query,
    );
    const differences = compareSchemas(expected, actual);
    return {
      status: differences.length === 0 ? 'ok' : 'degraded',
      database: actual.databaseName,
      differenceCount: differences.length,
      differences: differences.slice(0, MAX_REPORTED_DIFFERENCES),
      truncated: differences.length > MAX_REPORTED_DIFFERENCES,
    };
  } catch (error) {
    return {
      status: 'error',
      differenceCount: 0,
      differences: [],
      error: error.code || error.name || 'SCHEMA_AUDIT_FAILED',
    };
  }
}

async function auditSchemas({ target = 'all', queryOverrides = {} } = {}) {
  const targets = target === 'all' ? ['main', 'competitor'] : [target];
  const checkedAt = new Date().toISOString();
  const next = { ...cachedAudit, checkedAt };
  const results = await Promise.all(
    targets.map((item) => auditTarget(item, queryOverrides[item])),
  );
  targets.forEach((item, index) => {
    next[item] = results[index];
  });
  const statuses = targets.map((item) => next[item].status);
  next.status = statuses.includes('error')
    ? 'error'
    : statuses.includes('degraded')
    ? 'degraded'
    : 'ok';
  cachedAudit = next;
  return JSON.parse(JSON.stringify(cachedAudit));
}

async function runStartupSchemaAudit() {
  const result = await auditSchemas({ target: 'all' });
  if (result.status === 'ok') {
    logger.info('[SchemaAudit] 主营库与竞品库schema检查通过');
  } else {
    logger.error('[SchemaAudit] 检测到数据库schema漂移', {
      status: result.status,
      mainDifferenceCount: result.main.differenceCount,
      competitorDifferenceCount: result.competitor.differenceCount,
      mainError: result.main.error || null,
      competitorError: result.competitor.error || null,
    });
  }
  return result;
}

function getSchemaAuditStatus() {
  return JSON.parse(JSON.stringify(cachedAudit));
}

module.exports = {
  auditSchemas,
  compareSchemas,
  getSchemaAuditStatus,
  isOperationalTable,
  parseInitSchema,
  runStartupSchemaAudit,
};
