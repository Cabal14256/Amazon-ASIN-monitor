const { parentPort } = require('worker_threads');

function escapeSQL(str) {
  if (str === null || str === undefined) {
    return 'NULL';
  }
  let strValue = str;
  if (typeof strValue !== 'string') {
    strValue = String(strValue);
  }
  return "'" + strValue.replace(/'/g, "''").replace(/\\/g, '\\\\') + "'";
}

function normalizeBufferValue(value) {
  if (!value) {
    return null;
  }
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  return null;
}

function buildTableData(payload) {
  const {
    tableName,
    rows = [],
    columnNames = [],
    batchSize = 100,
  } = payload || {};

  if (!tableName) {
    throw new Error('tableName 不能为空');
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return { sql: '' };
  }

  if (!Array.isArray(columnNames) || columnNames.length === 0) {
    throw new Error(`表 ${tableName} 缺少列信息`);
  }

  let sql = `\n-- Dumping data for table \`${tableName}\`\n\n`;
  sql += `LOCK TABLES \`${tableName}\` WRITE;\n`;
  sql += `/*!40000 ALTER TABLE \`${tableName}\` DISABLE KEYS */;\n`;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values = batch.map((row) => {
      const rowValues = columnNames.map((col) => {
        const value = row[col];
        if (value === null || value === undefined) {
          return 'NULL';
        }
        if (typeof value === 'string') {
          return escapeSQL(value);
        }
        if (typeof value === 'number') {
          return value;
        }
        if (value instanceof Date) {
          return escapeSQL(value.toISOString().slice(0, 19).replace('T', ' '));
        }

        const normalizedBuffer = normalizeBufferValue(value);
        if (normalizedBuffer) {
          return `0x${normalizedBuffer.toString('hex')}`;
        }

        return escapeSQL(String(value));
      });
      return `(${rowValues.join(',')})`;
    });

    sql += `INSERT INTO \`${tableName}\` (\`${columnNames.join(
      '`, `',
    )}\`) VALUES ${values.join(',')};\n`;
  }

  sql += `/*!40000 ALTER TABLE \`${tableName}\` ENABLE KEYS */;\n`;
  sql += `UNLOCK TABLES;\n`;
  return { sql };
}

function splitSqlStatements(payload) {
  const { sqlContent = '' } = payload || {};
  if (typeof sqlContent !== 'string') {
    throw new Error('sqlContent 必须是字符串');
  }

  const statements = [];
  let currentStatement = '';
  let inString = false;
  let stringChar = null;

  for (let i = 0; i < sqlContent.length; i++) {
    const char = sqlContent[i];

    if (
      (char === "'" || char === '"') &&
      (i === 0 || sqlContent[i - 1] !== '\\')
    ) {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
        stringChar = null;
      }
    }

    currentStatement += char;

    if (!inString && char === ';') {
      const trimmed = currentStatement.trim();
      if (trimmed && !trimmed.startsWith('--') && trimmed.length > 1) {
        statements.push(trimmed);
      }
      currentStatement = '';
    }
  }

  return { statements };
}

const TASK_MAP = {
  buildTableData,
  splitSqlStatements,
};

parentPort.on('message', async (message) => {
  const { requestId, task, payload } = message || {};
  try {
    const handler = TASK_MAP[task];
    if (!handler) {
      throw new Error(`不支持的任务类型: ${task}`);
    }

    const result = await handler(payload);
    parentPort.postMessage({
      requestId,
      success: true,
      result,
    });
  } catch (error) {
    parentPort.postMessage({
      requestId,
      success: false,
      error: error?.message || 'worker 执行失败',
    });
  }
});
