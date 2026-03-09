const { pool } = require('../config/database');
const fs = require('fs').promises;
const path = require('path');
const { Worker } = require('worker_threads');
const {
  getUTC8ISOString,
  getUTC8String,
  toUTC8ISOString,
} = require('../utils/dateTime');
const logger = require('../utils/logger');

// 备份文件存储目录
const BACKUP_DIR = path.join(__dirname, '../../backups');
const BACKUP_WORKER_SCRIPT = path.join(
  __dirname,
  '../workers/backup/sqlWorker.js',
);
const BACKUP_WORKER_TIMEOUT_MS =
  Number(process.env.BACKUP_WORKER_TIMEOUT_MS) || 5 * 60 * 1000;
const BACKUP_WORKER_ENABLED = !['false', '0', 'no', 'off'].includes(
  String(process.env.BACKUP_WORKER_ENABLED || 'false')
    .trim()
    .toLowerCase(),
);

// 确保备份目录存在
async function ensureBackupDir() {
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
  } catch (error) {
    logger.error('创建备份目录失败:', error);
    throw error;
  }
}

/**
 * 转义 SQL 字符串
 */
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

async function runOptionalHook(fn, payload) {
  if (typeof fn === 'function') {
    await fn(payload);
  }
}

function runBackupSqlWorkerTask(
  task,
  payload,
  timeoutMs = BACKUP_WORKER_TIMEOUT_MS,
) {
  return new Promise((resolve, reject) => {
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const worker = new Worker(BACKUP_WORKER_SCRIPT);
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      worker.terminate().catch(() => {});
      reject(new Error(`备份Worker超时（${timeoutMs}ms）`));
    }, timeoutMs);

    worker.once('message', (message) => {
      const { requestId: responseId, success, result, error } = message || {};
      if (responseId !== requestId || settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});

      if (!success) {
        reject(new Error(error || '备份Worker执行失败'));
        return;
      }

      resolve(result);
    });

    worker.once('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      reject(error);
    });

    worker.once('exit', (code) => {
      if (settled || code === 0) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(new Error(`备份Worker异常退出，code=${code}`));
    });

    worker.postMessage({
      requestId,
      task,
      payload,
    });
  });
}

function buildTableDataSync(tableName, rows, columnNames) {
  // 生成 INSERT 语句
  let sql = `\n-- Dumping data for table \`${tableName}\`\n\n`;
  sql += `LOCK TABLES \`${tableName}\` WRITE;\n`;
  sql += `/*!40000 ALTER TABLE \`${tableName}\` DISABLE KEYS */;\n`;

  // 批量插入，每批 100 条
  const batchSize = 100;
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
          return escapeSQL(
            toUTC8ISOString(value).slice(0, 19).replace('T', ' '),
          );
        }
        if (Buffer.isBuffer(value)) {
          return `0x${value.toString('hex')}`;
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

  return sql;
}

function splitSqlStatementsSync(sqlContent) {
  const statements = [];
  let currentStatement = '';
  let inString = false;
  let stringChar = null;

  for (let i = 0; i < sqlContent.length; i++) {
    const char = sqlContent[i];

    // 处理字符串
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

    // 如果不在字符串中且遇到分号，则是一个完整的语句
    if (!inString && char === ';') {
      const trimmed = currentStatement.trim();
      if (trimmed && !trimmed.startsWith('--') && trimmed.length > 1) {
        statements.push(trimmed);
      }
      currentStatement = '';
    }
  }

  return statements;
}

/**
 * 生成表的 CREATE TABLE 语句
 */
async function getTableCreateStatement(connection, tableName) {
  const [rows] = await connection.execute(`SHOW CREATE TABLE \`${tableName}\``);
  // MySQL 返回的字段名可能是 'Create Table' 或 'CREATE TABLE'，需要兼容处理
  const createTable =
    rows[0]['Create Table'] || rows[0]['CREATE TABLE'] || rows[0].createTable;
  if (!createTable) {
    throw new Error(`无法获取表 ${tableName} 的创建语句`);
  }
  return createTable + ';';
}

/**
 * 生成表的 INSERT 语句
 */
async function getTableData(connection, tableName) {
  const [rows] = await connection.execute(`SELECT * FROM \`${tableName}\``);
  if (rows.length === 0) {
    return '';
  }

  // 获取列名
  const [columns] = await connection.execute(
    `SHOW COLUMNS FROM \`${tableName}\``,
  );
  // MySQL 返回的字段名可能是 'Field' 或 'FIELD'，需要兼容处理
  const columnNames = columns
    .map((col) => col.Field || col.FIELD || col.field)
    .filter(Boolean);

  if (BACKUP_WORKER_ENABLED) {
    try {
      const workerResult = await runBackupSqlWorkerTask('buildTableData', {
        tableName,
        rows,
        columnNames,
      });
      return workerResult?.sql || '';
    } catch (error) {
      logger.warn(
        `[备份] 表 ${tableName} SQL构建Worker失败，回退主线程: ${error.message}`,
      );
    }
  }

  return buildTableDataSync(tableName, rows, columnNames);
}

/**
 * 执行数据库备份（使用 Node.js MySQL 库，不依赖命令行工具）
 * @param {Object} options 备份选项
 * @returns {Promise<string>} 备份文件路径
 */
async function createBackup(options = {}) {
  const {
    tables = null,
    description = '',
    onProgress = null,
    checkCancelled = null,
  } = options;

  await ensureBackupDir();

  const timestamp = getUTC8String('YYYY-MM-DD-HH-mm-ss');
  const filename = `backup_${timestamp}.sql`;
  const filepath = path.join(BACKUP_DIR, filename);

  let connection;
  try {
    // 使用连接池获取连接
    connection = await pool.getConnection();

    // 添加备份元数据
    let sqlContent = `-- Backup created at: ${getUTC8ISOString()}\n`;
    if (description) {
      sqlContent += `-- Description: ${description}\n`;
    }
    sqlContent += `-- Generated by Node.js MySQL backup service\n\n`;
    sqlContent += `SET NAMES utf8mb4;\n`;
    sqlContent += `SET FOREIGN_KEY_CHECKS = 0;\n\n`;

    // 获取要备份的表列表
    let tablesToBackup = [];
    if (tables && Array.isArray(tables) && tables.length > 0) {
      // 验证表是否存在
      const placeholders = tables.map(() => '?').join(',');
      const [existingTables] = await connection.execute(
        `SELECT TABLE_NAME as table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND TABLE_NAME IN (${placeholders})`,
        tables,
      );
      tablesToBackup = existingTables
        .map((t) => t.table_name || t.TABLE_NAME)
        .filter((name) => name); // 过滤掉 undefined 和 null
      sqlContent += `-- Tables: ${tablesToBackup.join(', ')}\n\n`;
    } else {
      // 备份所有表
      const [allTables] = await connection.execute(
        `SELECT TABLE_NAME as table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY TABLE_NAME`,
      );
      tablesToBackup = allTables
        .map((t) => t.table_name || t.TABLE_NAME)
        .filter((name) => name); // 过滤掉 undefined 和 null
      sqlContent += `-- Full database backup (${tablesToBackup.length} tables)\n\n`;
    }

    if (tablesToBackup.length === 0) {
      throw new Error('没有找到要备份的表');
    }

    logger.info(`准备备份 ${tablesToBackup.length} 个表:`, tablesToBackup);
    await runOptionalHook(onProgress, {
      current: 0,
      total: tablesToBackup.length,
      stage: 'prepare',
    });

    // 备份每个表
    for (let index = 0; index < tablesToBackup.length; index += 1) {
      const tableName = tablesToBackup[index];
      if (!tableName || typeof tableName !== 'string') {
        logger.warn(`跳过无效的表名: ${tableName}`);
        continue;
      }

      await runOptionalHook(
        checkCancelled,
        `备份任务已取消（在处理表 ${tableName} 前停止）`,
      );
      logger.info(`正在备份表: ${tableName}`);
      await runOptionalHook(onProgress, {
        current: index + 1,
        total: tablesToBackup.length,
        tableName,
        stage: 'backup_table',
      });

      try {
        // 生成 CREATE TABLE 语句
        sqlContent += `\n-- --------------------------------------------------------\n`;
        sqlContent += `-- Table structure for table \`${tableName}\`\n`;
        sqlContent += `-- --------------------------------------------------------\n\n`;
        sqlContent += `DROP TABLE IF EXISTS \`${tableName}\`;\n`;
        const createTable = await getTableCreateStatement(
          connection,
          tableName,
        );
        sqlContent += createTable + '\n\n';

        // 生成 INSERT 语句
        sqlContent += `-- --------------------------------------------------------\n`;
        sqlContent += `-- Dumping data for table \`${tableName}\`\n`;
        sqlContent += `-- --------------------------------------------------------\n\n`;
        const tableData = await getTableData(connection, tableName);
        sqlContent += tableData + '\n';
      } catch (error) {
        logger.error(`备份表 ${tableName} 时出错:`, error.message);
        throw error;
      }
    }

    sqlContent += `SET FOREIGN_KEY_CHECKS = 1;\n`;

    // 写入文件
    await fs.writeFile(filepath, sqlContent, 'utf8');

    const stats = await fs.stat(filepath);
    return {
      filename,
      filepath,
      size: stats.size,
      createdAt: getUTC8ISOString(),
    };
  } catch (error) {
    logger.error('备份失败:', error);
    // 如果文件已创建但备份失败，删除文件
    try {
      await fs.unlink(filepath);
    } catch (e) {
      // 忽略删除错误
    }
    throw new Error(`备份失败: ${error.message}`);
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

/**
 * 恢复数据库（使用 Node.js MySQL 库执行 SQL 文件）
 * @param {string} filepath 备份文件路径
 * @returns {Promise<void>}
 */
async function restoreBackup(filepath) {
  return restoreBackupWithOptions(filepath, {});
}

async function restoreBackupWithOptions(filepath, options = {}) {
  const { onProgress = null, checkCancelled = null } = options;
  // 验证文件是否存在
  try {
    await fs.access(filepath);
  } catch (error) {
    throw new Error('备份文件不存在');
  }

  let connection;
  try {
    // 使用连接池获取连接
    connection = await pool.getConnection();

    // 读取 SQL 文件
    const sqlContent = await fs.readFile(filepath, 'utf8');

    let statements = [];
    if (BACKUP_WORKER_ENABLED) {
      try {
        const workerResult = await runBackupSqlWorkerTask(
          'splitSqlStatements',
          {
            sqlContent,
          },
        );
        statements = Array.isArray(workerResult?.statements)
          ? workerResult.statements
          : [];
      } catch (error) {
        logger.warn(
          `[恢复] SQL拆分Worker失败，回退主线程解析: ${error.message}`,
        );
        statements = splitSqlStatementsSync(sqlContent);
      }
    } else {
      statements = splitSqlStatementsSync(sqlContent);
    }

    // 执行所有 SQL 语句
    logger.info(`开始恢复备份，共 ${statements.length} 条 SQL 语句`);
    await runOptionalHook(onProgress, {
      current: 0,
      total: statements.length,
      stage: 'prepare_restore',
    });

    // 禁用外键检查
    await connection.execute('SET FOREIGN_KEY_CHECKS = 0');

    for (let i = 0; i < statements.length; i++) {
      if (i % 25 === 0) {
        await runOptionalHook(
          checkCancelled,
          `恢复任务已取消（已执行 ${i}/${statements.length} 条语句）`,
        );
        await runOptionalHook(onProgress, {
          current: i,
          total: statements.length,
          stage: 'restore',
        });
      }
      const statement = statements[i].trim();
      if (statement && !statement.startsWith('--')) {
        try {
          await connection.execute(statement);
          if ((i + 1) % 100 === 0) {
            logger.debug(`已执行 ${i + 1}/${statements.length} 条语句`);
          }
        } catch (error) {
          // 忽略某些错误（如表已存在等）
          if (
            !error.message.includes('already exists') &&
            !error.message.includes('Unknown table')
          ) {
            logger.warn(
              `执行语句时出错 (${i + 1}/${statements.length}):`,
              error.message,
            );
            logger.warn(`语句: ${statement.substring(0, 100)}...`);
          }
        }
      }
    }

    await runOptionalHook(onProgress, {
      current: statements.length,
      total: statements.length,
      stage: 'restore',
    });

    // 启用外键检查
    await connection.execute('SET FOREIGN_KEY_CHECKS = 1');

    logger.info('备份恢复完成');
  } catch (error) {
    logger.error('恢复失败:', error);
    throw new Error(`恢复失败: ${error.message}`);
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

/**
 * 获取备份文件列表
 * @returns {Promise<Array>}
 */
async function listBackups() {
  await ensureBackupDir();

  try {
    const files = await fs.readdir(BACKUP_DIR);
    const backups = [];

    for (const file of files) {
      if (file.endsWith('.sql')) {
        const filepath = path.join(BACKUP_DIR, file);
        const stats = await fs.stat(filepath);
        backups.push({
          filename: file,
          filepath,
          size: stats.size,
          createdAt: toUTC8ISOString(stats.birthtime),
          modifiedAt: toUTC8ISOString(stats.mtime),
        });
      }
    }

    // 按创建时间倒序排列
    backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return backups;
  } catch (error) {
    logger.error('获取备份列表失败:', error);
    throw new Error(`获取备份列表失败: ${error.message}`);
  }
}

/**
 * 删除备份文件
 * @param {string} filename 文件名
 * @returns {Promise<void>}
 */
async function deleteBackup(filename) {
  // 安全检查：确保文件名只包含安全字符
  // 文件名格式: backup_2025-12-03T10-09-40.sql (包含 T 字符)
  if (!/^backup_[0-9T-]+\.sql$/.test(filename)) {
    throw new Error('无效的文件名');
  }

  // 额外的安全检查：防止路径遍历攻击
  if (
    filename.includes('..') ||
    filename.includes('/') ||
    filename.includes('\\')
  ) {
    throw new Error('无效的文件名：包含非法字符');
  }

  const filepath = path.join(BACKUP_DIR, filename);

  try {
    await fs.unlink(filepath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('备份文件不存在');
    }
    throw new Error(`删除备份失败: ${error.message}`);
  }
}

/**
 * 获取备份文件内容（用于下载）
 * @param {string} filename 文件名
 * @returns {Promise<Buffer>}
 */
async function getBackupFile(filename) {
  // 安全检查：确保文件名只包含安全字符
  // 文件名格式: backup_2025-12-03T10-09-40.sql (包含 T 字符)
  if (!/^backup_[0-9T-]+\.sql$/.test(filename)) {
    throw new Error('无效的文件名');
  }

  // 额外的安全检查：防止路径遍历攻击
  if (
    filename.includes('..') ||
    filename.includes('/') ||
    filename.includes('\\')
  ) {
    throw new Error('无效的文件名：包含非法字符');
  }

  const filepath = path.join(BACKUP_DIR, filename);

  try {
    return await fs.readFile(filepath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('备份文件不存在');
    }
    throw new Error(`读取备份文件失败: ${error.message}`);
  }
}

module.exports = {
  createBackup,
  restoreBackup: restoreBackupWithOptions,
  listBackups,
  deleteBackup,
  getBackupFile,
};
