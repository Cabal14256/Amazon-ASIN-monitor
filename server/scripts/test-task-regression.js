#!/usr/bin/env node

const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const { Blob } = require('buffer');
const ExcelJS = require('exceljs');
const { loadEnv } = require('./utils/loadEnv');

loadEnv(path.join(__dirname, '../.env'));

const logger = require('../src/utils/logger');
const { query } = require('../src/config/database');
const User = require('../src/models/User');
const Session = require('../src/models/Session');

const DEFAULT_SERVER_URL = process.env.API_BASE_URL || 'http://localhost:3001';
const DEFAULT_TIMEOUT_MS =
  Number(process.env.TASK_REGRESSION_TIMEOUT_MS) || 180000;
const REQUIRED_PERMISSIONS = [
  'asin:read',
  'asin:write',
  'monitor:read',
  'settings:write',
];

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    serverUrl: DEFAULT_SERVER_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    keepArtifacts: false,
    allowRestore: false,
    queuePrefix: '',
  };

  for (const arg of args) {
    if (arg.startsWith('--server-url=')) {
      config.serverUrl = arg.slice('--server-url='.length);
    } else if (arg.startsWith('--timeout-ms=')) {
      config.timeoutMs =
        Number(arg.slice('--timeout-ms='.length)) || DEFAULT_TIMEOUT_MS;
    } else if (arg === '--keep-artifacts') {
      config.keepArtifacts = true;
    } else if (arg === '--allow-restore') {
      config.allowRestore = true;
    } else if (arg.startsWith('--queue-prefix=')) {
      config.queuePrefix = arg.slice('--queue-prefix='.length).trim();
    }
  }

  config.serverUrl = String(config.serverUrl || DEFAULT_SERVER_URL).replace(
    /\/+$/,
    '',
  );
  return config;
}

function assertCondition(condition, message) {
  if (!condition) {
    const error = new Error(message);
    error.isAssertionError = true;
    throw error;
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const error = new Error(
      payload?.errorMessage ||
        payload?.message ||
        `HTTP ${response.status} ${response.statusText}`,
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function fetchBinary(url, options = {}) {
  const response = await fetch(url, options);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    const text = buffer.toString('utf8');
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      payload = null;
    }
    const error = new Error(
      payload?.errorMessage ||
        payload?.message ||
        `HTTP ${response.status} ${response.statusText}`,
    );
    error.status = response.status;
    error.payload = payload || text;
    throw error;
  }

  return {
    buffer,
    headers: response.headers,
  };
}

async function getQueueStateByTaskType(taskType, taskId) {
  try {
    if (taskType === 'import') {
      const moduleRef = require('../src/services/importTaskQueue');
      return moduleRef.getJobState(taskId);
    }
    if (taskType === 'export') {
      const moduleRef = require('../src/services/exportTaskQueue');
      return moduleRef.getJobState(taskId);
    }
    if (taskType === 'backup') {
      const moduleRef = require('../src/services/backupTaskQueue');
      return moduleRef.getJobState(taskId);
    }
    if (taskType === 'batch-check') {
      const moduleRef = require('../src/services/batchCheckTaskQueue');
      return moduleRef.getJobState(taskId);
    }
    return null;
  } catch (error) {
    return {
      state: 'error',
      failedReason: error.message,
    };
  }
}

async function findRegressionUser() {
  const placeholders = REQUIRED_PERMISSIONS.map(() => '?').join(',');
  const rows = await query(
    `SELECT
       u.id,
       u.username,
       u.real_name,
       COUNT(DISTINCT p.code) AS permission_count
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE u.status = 'ACTIVE'
       AND p.code IN (${placeholders})
     GROUP BY u.id, u.username, u.real_name
     HAVING COUNT(DISTINCT p.code) = ?
     ORDER BY u.username ASC
     LIMIT 1`,
    [...REQUIRED_PERMISSIONS, REQUIRED_PERMISSIONS.length],
  );

  assertCondition(rows.length > 0, '未找到具备回归所需权限的活跃用户');
  return rows[0];
}

async function createRegressionSession(user) {
  const sessionId = `task-regression-${Date.now()}`;
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  await Session.create({
    id: sessionId,
    userId: user.id,
    userAgent: 'task-regression-script',
    ipAddress: '127.0.0.1',
    expiresAt,
    rememberMe: false,
  });
  const token = User.generateToken(user.id, sessionId, '2h');
  return {
    sessionId,
    token,
    authHeaders: {
      Authorization: `Bearer ${token}`,
    },
  };
}

async function revokeRegressionSession(sessionId, userId) {
  try {
    await Session.revoke(sessionId, userId);
  } catch (error) {
    logger.warn('[task-regression] 释放测试会话失败', {
      message: error.message,
      sessionId,
      userId,
    });
  }
}

async function ensureServerAvailable(serverUrl) {
  const healthUrl = `${serverUrl}/health`;
  const response = await fetch(healthUrl, { method: 'GET' });
  assertCondition(response.ok, `服务不可用: ${healthUrl}`);
}

async function isServerAvailable(serverUrl) {
  try {
    await ensureServerAvailable(serverUrl);
    return true;
  } catch (error) {
    return false;
  }
}

async function waitForServerAvailable(serverUrl, timeoutMs = 120000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (await isServerAvailable(serverUrl)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`服务启动超时: ${serverUrl}`);
}

function startLocalServerProcess(queuePrefix) {
  const serverCwd = path.join(__dirname, '..');
  const child = spawn('node', ['src/index.js'], {
    cwd: serverCwd,
    env: {
      ...process.env,
      PROCESS_ROLE: 'all',
      SCHEDULER_ENABLED: 'false',
      AUTO_BACKUP_ENABLED: 'false',
      IMPORT_PARSE_WORKER_ENABLED: 'false',
      BULL_PREFIX: queuePrefix,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (chunk) => {
    const lines = String(chunk || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      if (
        line.includes('服务器运行在') ||
        line.includes('Bootstrap') ||
        line.includes('数据库连接成功') ||
        line.includes('竞品数据库连接成功') ||
        line.includes('队列处理器注册完成') ||
        line.includes('[导入任务]') ||
        line.includes('[ERROR]') ||
        line.includes('[WARN]')
      ) {
        logger.info('[task-regression][server]', {
          output: line.slice(0, 500),
        });
      }
    }
  });
  child.stderr?.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (text) {
      logger.warn('[task-regression][server]', { output: text.slice(0, 500) });
    }
  });

  return child;
}

async function stopManagedServer(serverRuntime) {
  if (!serverRuntime?.managed || !serverRuntime?.process?.pid) {
    return;
  }

  const managedProcess = serverRuntime.process;
  if (managedProcess.exitCode !== null || managedProcess.killed) {
    return;
  }

  logger.info('[task-regression] 停止自动拉起的本地服务', {
    pid: managedProcess.pid,
  });

  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', [
        '/PID',
        String(managedProcess.pid),
        '/T',
        '/F',
      ]);
      killer.on('close', () => resolve());
      killer.on('error', () => resolve());
    });
    return;
  }

  managedProcess.kill('SIGTERM');
}

async function ensureServerWithAutoStart(serverUrl, queuePrefix) {
  if (await isServerAvailable(serverUrl)) {
    logger.warn(
      '[task-regression] 检测到服务已可用，复用当前运行实例（不会注入独立队列前缀）',
      { serverUrl },
    );
    return { managed: false, process: null };
  }

  logger.warn('[task-regression] 服务不可用，开始自动启动本地服务', {
    queuePrefix,
  });
  const localProcess = startLocalServerProcess(queuePrefix);

  try {
    await waitForServerAvailable(serverUrl, 120000);
    logger.info('[task-regression] 本地服务启动成功');
    return { managed: true, process: localProcess };
  } catch (error) {
    await stopManagedServer({ managed: true, process: localProcess });
    throw error;
  }
}

async function waitForTask(serverUrl, authHeaders, taskId, timeoutMs) {
  const startedAt = Date.now();
  let lastStatus = null;
  let warnedInconsistentState = false;
  let lastQueueCheckAt = 0;

  while (Date.now() - startedAt <= timeoutMs) {
    const payload = await fetchJson(`${serverUrl}/api/v1/tasks/${taskId}`, {
      headers: authHeaders,
    });
    const task = payload?.data || payload;

    if (task?.status !== lastStatus) {
      lastStatus = task?.status || null;
      logger.info('[task-regression] 任务状态更新', {
        taskId,
        status: task?.status,
        progress: task?.progress,
        message: task?.message,
      });
    }

    if (
      !warnedInconsistentState &&
      task?.status === 'processing' &&
      Number(task?.progress) >= 100
    ) {
      warnedInconsistentState = true;
      logger.warn(
        '[task-regression] 检测到任务状态异常（processing 且 progress=100）',
        {
          taskId,
          snapshot: task,
        },
      );
    }

    if (
      Date.now() - startedAt > 15000 &&
      Date.now() - lastQueueCheckAt > 15000
    ) {
      lastQueueCheckAt = Date.now();
      const queueState = await getQueueStateByTaskType(task?.taskType, taskId);
      logger.info('[task-regression] 队列状态快照', {
        taskId,
        taskType: task?.taskType,
        queueState,
      });
    }

    if (task?.status === 'completed') {
      if (!task?.result || typeof task?.result?.summary !== 'string') {
        const queueState = await getQueueStateByTaskType(
          task?.taskType,
          taskId,
        );
        logger.warn('[task-regression] completed 但结果缺失，读取队列详情', {
          taskId,
          taskType: task?.taskType,
          taskSnapshot: task,
          queueState,
        });
      }
      return task;
    }
    if (task?.status === 'failed' || task?.status === 'cancelled') {
      throw new Error(
        task?.error || task?.message || `任务执行失败: ${taskId}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error(`等待任务超时: ${taskId}`);
}

async function verifyTaskAppearsInList(serverUrl, authHeaders, taskId) {
  const payload = await fetchJson(
    `${serverUrl}/api/v1/tasks?status=all&limit=100`,
    {
      headers: authHeaders,
    },
  );
  const tasks = Array.isArray(payload?.data) ? payload.data : [];
  assertCondition(
    tasks.some((item) => item.taskId === taskId),
    `任务列表中未找到任务 ${taskId}`,
  );
}

function buildImportWorkbookBuffer(testData) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('ASIN Import');
  worksheet.addRow(['变体组名称', '国家', '站点', '品牌', 'ASIN', 'ASIN类型']);
  worksheet.addRow([
    testData.groupName,
    testData.country,
    testData.site,
    testData.brand,
    testData.validAsin,
    '1',
  ]);
  worksheet.addRow([
    testData.groupName,
    testData.country,
    '',
    testData.brand,
    testData.invalidAsin,
    '2',
  ]);
  return workbook.xlsx.writeBuffer();
}

async function createImportTask(serverUrl, authHeaders, testData) {
  const workbookBuffer = await buildImportWorkbookBuffer(testData);
  const formData = new FormData();
  formData.append(
    'file',
    new Blob([Buffer.from(workbookBuffer)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${testData.groupName}.xlsx`,
  );
  formData.append('useAsync', 'true');

  const payload = await fetchJson(
    `${serverUrl}/api/v1/variant-groups/import-excel`,
    {
      method: 'POST',
      headers: authHeaders,
      body: formData,
    },
  );

  const taskId = payload?.data?.taskId;
  assertCondition(taskId, '导入任务创建失败：未返回 taskId');
  return taskId;
}

async function createExportTask(serverUrl, authHeaders, testData) {
  const payload = await fetchJson(`${serverUrl}/api/v1/tasks/export`, {
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      exportType: 'variant-group',
      params: {
        keyword: testData.groupName,
        country: testData.country,
      },
    }),
  });

  const taskId = payload?.data?.taskId;
  assertCondition(taskId, '导出任务创建失败：未返回 taskId');
  return taskId;
}

async function createBackupTask(serverUrl, authHeaders, testData) {
  const payload = await fetchJson(`${serverUrl}/api/v1/backup`, {
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      useAsync: true,
      tables: ['variant_groups', 'asins', 'sessions'],
      description: `task-regression-${testData.runId}`,
    }),
  });

  const taskId = payload?.data?.taskId;
  assertCondition(taskId, '备份任务创建失败：未返回 taskId');
  return taskId;
}

async function createRestoreTask(serverUrl, authHeaders, filename) {
  const payload = await fetchJson(`${serverUrl}/api/v1/backup/restore`, {
    method: 'POST',
    headers: {
      ...authHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      useAsync: true,
      filename,
    }),
  });

  const taskId = payload?.data?.taskId;
  assertCondition(taskId, '恢复任务创建失败：未返回 taskId');
  return taskId;
}

async function verifyImportTask(serverUrl, authHeaders, task, testData) {
  await verifyTaskAppearsInList(serverUrl, authHeaders, task.taskId);
  const result = task.result || {};
  assertCondition(
    typeof result.summary === 'string' && result.summary.length > 0,
    '导入结果缺少 summary',
  );
  assertCondition(
    result.total === 2,
    `导入 total 异常，实际为 ${result.total}`,
  );
  assertCondition(
    result.successCount === 1,
    `导入 successCount 异常，实际为 ${result.successCount}`,
  );
  assertCondition(
    result.failedCount === 0,
    `导入 failedCount 异常，实际为 ${result.failedCount}`,
  );
  assertCondition(
    result.missingCount === 1,
    `导入 missingCount 异常，实际为 ${result.missingCount}`,
  );
  assertCondition(
    result.verificationPassed === false,
    '导入 verificationPassed 应为 false',
  );
  assertCondition(
    Array.isArray(result.warnings) && result.warnings.length > 0,
    '导入结果缺少 warnings',
  );

  const rows = await query(
    `SELECT id, asin FROM asins WHERE asin = ? AND country = ?`,
    [testData.validAsin, testData.country],
  );
  assertCondition(rows.length === 1, '导入后的有效 ASIN 未落库');
}

async function verifyExportTask(
  serverUrl,
  authHeaders,
  task,
  testData,
  keepArtifacts,
) {
  await verifyTaskAppearsInList(serverUrl, authHeaders, task.taskId);
  const result = task.result || {};
  assertCondition(
    typeof result.summary === 'string' && result.summary.length > 0,
    '导出结果缺少 summary',
  );
  assertCondition(
    result.verificationPassed === true,
    '导出 verificationPassed 应为 true',
  );
  assertCondition(
    result.filename && result.downloadUrl,
    '导出结果缺少文件元数据',
  );

  const download = await fetchBinary(
    `${serverUrl}/api/v1/tasks/${task.taskId}/download`,
    {
      headers: authHeaders,
    },
  );
  assertCondition(download.buffer.length > 0, '导出下载文件为空');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(download.buffer);
  const worksheet = workbook.worksheets[0];
  assertCondition(Boolean(worksheet), '导出文件中缺少工作表');
  const rows = [];
  worksheet.eachRow((row) => {
    rows.push(row.values);
  });
  const flatText = rows.flat().join(' ');
  assertCondition(
    flatText.includes(testData.groupName),
    '导出文件未包含回归测试数据',
  );

  if (keepArtifacts) {
    const exportPath = path.join(os.tmpdir(), result.filename);
    await fs.writeFile(exportPath, download.buffer);
    logger.info('[task-regression] 已保留导出文件', { exportPath });
  }
}

async function verifyBackupTask(serverUrl, authHeaders, task, keepArtifacts) {
  await verifyTaskAppearsInList(serverUrl, authHeaders, task.taskId);
  const result = task.result || {};
  assertCondition(
    typeof result.summary === 'string' && result.summary.length > 0,
    '备份结果缺少 summary',
  );
  assertCondition(
    result.verificationPassed === true,
    '备份 verificationPassed 应为 true',
  );
  assertCondition(
    result.filename && result.downloadUrl,
    '备份结果缺少文件元数据',
  );

  const download = await fetchBinary(
    `${serverUrl}/api/v1/tasks/${task.taskId}/download`,
    {
      headers: authHeaders,
    },
  );
  assertCondition(download.buffer.length > 0, '备份下载文件为空');
  const sqlText = download.buffer.toString('utf8');
  assertCondition(
    sqlText.includes('DROP TABLE IF EXISTS `variant_groups`'),
    '备份文件未包含 variant_groups 表结构',
  );
  assertCondition(
    sqlText.includes('DROP TABLE IF EXISTS `asins`'),
    '备份文件未包含 asins 表结构',
  );

  if (keepArtifacts) {
    const backupPath = path.join(os.tmpdir(), result.filename);
    await fs.writeFile(backupPath, download.buffer);
    logger.info('[task-regression] 已保留备份文件', { backupPath });
  }

  return result.filename;
}

async function verifyRestoreTask(serverUrl, authHeaders, task) {
  await verifyTaskAppearsInList(serverUrl, authHeaders, task.taskId);
  const result = task.result || {};
  assertCondition(
    typeof result.summary === 'string' && result.summary.length > 0,
    '恢复结果缺少 summary',
  );
  assertCondition(
    result.verificationPassed === true,
    '恢复 verificationPassed 应为 true',
  );
  assertCondition(
    result.healthCheck?.passed === true,
    '恢复任务健康检查未通过',
  );
}

async function cleanupImportedData(testData) {
  await query(
    `DELETE FROM variant_groups WHERE name = ? AND country = ? AND site = ? AND brand = ?`,
    [testData.groupName, testData.country, testData.site, testData.brand],
  );
}

async function cleanupBackupArtifact(serverUrl, authHeaders, filename) {
  if (!filename) {
    return;
  }
  try {
    await fetchJson(
      `${serverUrl}/api/v1/backup/${encodeURIComponent(filename)}`,
      {
        method: 'DELETE',
        headers: authHeaders,
      },
    );
  } catch (error) {
    logger.warn('[task-regression] 删除备份文件失败', {
      filename,
      message: error.message,
    });
  }
}

async function cleanQueueByStates(queueModule, queueName) {
  const queue = queueModule?.queue;
  if (!queue) {
    return;
  }

  const states = ['wait', 'active', 'delayed', 'paused', 'failed', 'completed'];
  for (const state of states) {
    try {
      await queue.clean(0, state, 1000);
    } catch (error) {
      logger.warn('[task-regression] 清理队列状态失败', {
        queueName,
        state,
        message: error.message,
      });
    }
  }
}

async function clearTaskQueuesForRegression() {
  const importTaskQueue = require('../src/services/importTaskQueue');
  const exportTaskQueue = require('../src/services/exportTaskQueue');
  const backupTaskQueue = require('../src/services/backupTaskQueue');
  const batchCheckTaskQueue = require('../src/services/batchCheckTaskQueue');

  logger.info('[task-regression] 清理任务队列历史作业');
  await cleanQueueByStates(importTaskQueue, 'import-task-queue');
  await cleanQueueByStates(exportTaskQueue, 'export-task-queue');
  await cleanQueueByStates(backupTaskQueue, 'backup-task-queue');
  await cleanQueueByStates(batchCheckTaskQueue, 'batch-check-task-queue');
}

async function run() {
  const config = parseArgs();
  const runId = `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`.toUpperCase();
  const queuePrefix =
    config.queuePrefix || `task-regression-${runId.toLowerCase()}`;
  process.env.BULL_PREFIX = queuePrefix;

  const testData = {
    runId,
    groupName: `TASK-REGRESSION-${runId}`,
    country: 'US',
    site: `REG-${runId.slice(-4)}`,
    brand: `TASK-REG-BRAND-${runId}`,
    validAsin: `T${runId.replace(/[^A-Z0-9]/g, '').slice(0, 9)}`.padEnd(
      10,
      'A',
    ),
    invalidAsin: `Z${runId.replace(/[^A-Z0-9]/g, '').slice(0, 9)}`.padEnd(
      10,
      'B',
    ),
  };

  let regressionUser = null;
  let session = null;
  let createdBackupFilename = null;
  let serverRuntime = null;

  logger.info('[task-regression] 开始执行回归脚本', {
    serverUrl: config.serverUrl,
    timeoutMs: config.timeoutMs,
    keepArtifacts: config.keepArtifacts,
    allowRestore: config.allowRestore,
    queuePrefix,
  });

  try {
    serverRuntime = await ensureServerWithAutoStart(
      config.serverUrl,
      queuePrefix,
    );
    regressionUser = await findRegressionUser();
    session = await createRegressionSession(regressionUser);

    logger.info('[task-regression] 使用测试用户', {
      userId: regressionUser.id,
      username: regressionUser.username,
    });

    await cleanupImportedData(testData);
    await clearTaskQueuesForRegression();

    const importTaskId = await createImportTask(
      config.serverUrl,
      session.authHeaders,
      testData,
    );
    const importTask = await waitForTask(
      config.serverUrl,
      session.authHeaders,
      importTaskId,
      config.timeoutMs,
    );
    await verifyImportTask(
      config.serverUrl,
      session.authHeaders,
      importTask,
      testData,
    );

    const exportTaskId = await createExportTask(
      config.serverUrl,
      session.authHeaders,
      testData,
    );
    const exportTask = await waitForTask(
      config.serverUrl,
      session.authHeaders,
      exportTaskId,
      config.timeoutMs,
    );
    await verifyExportTask(
      config.serverUrl,
      session.authHeaders,
      exportTask,
      testData,
      config.keepArtifacts,
    );

    const backupTaskId = await createBackupTask(
      config.serverUrl,
      session.authHeaders,
      testData,
    );
    const backupTask = await waitForTask(
      config.serverUrl,
      session.authHeaders,
      backupTaskId,
      config.timeoutMs,
    );
    createdBackupFilename = await verifyBackupTask(
      config.serverUrl,
      session.authHeaders,
      backupTask,
      config.keepArtifacts,
    );

    if (config.allowRestore && createdBackupFilename) {
      const restoreTaskId = await createRestoreTask(
        config.serverUrl,
        session.authHeaders,
        createdBackupFilename,
      );
      const restoreTask = await waitForTask(
        config.serverUrl,
        session.authHeaders,
        restoreTaskId,
        config.timeoutMs,
      );
      await verifyRestoreTask(
        config.serverUrl,
        session.authHeaders,
        restoreTask,
      );
    } else {
      logger.warn('[task-regression] 已跳过恢复备份任务，默认不执行破坏性回归');
    }

    logger.info('[task-regression] 回归脚本执行完成', {
      importTaskId,
      exportTaskId,
      backupTaskId,
      restoreExecuted: config.allowRestore,
    });
  } finally {
    await cleanupImportedData(testData);
    if (
      !config.keepArtifacts &&
      createdBackupFilename &&
      session?.authHeaders
    ) {
      await cleanupBackupArtifact(
        config.serverUrl,
        session.authHeaders,
        createdBackupFilename,
      );
    }
    if (session?.sessionId && regressionUser?.id) {
      await revokeRegressionSession(session.sessionId, regressionUser.id);
    }
    await stopManagedServer(serverRuntime);
  }
}

run()
  .then(() => {
    logger.info('[task-regression] 所有检查通过');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('[task-regression] 回归失败', {
      message: error.message,
      status: error.status,
      payload: error.payload,
    });
    process.exit(1);
  });
