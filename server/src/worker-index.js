require('dotenv').config();
const logger = require('./utils/logger');
const { validateEnv } = require('./config/envValidator');
const { testConnection } = require('./config/database');
const {
  testConnection: testCompetitorConnection,
} = require('./config/competitor-database');
const { getProcessRole, isWorkerRole } = require('./config/processRole');
const {
  registerWorkerProcessors,
  getWorkerRegistrationStatus,
  getRegisteredQueueInstances,
} = require('./services/workerProcessorRegistry');

let isShuttingDown = false;

async function closeRegisteredQueues(signal) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.info(`[Worker] 收到 ${signal}，开始优雅关闭队列消费者...`);
  const queueInstances = getRegisteredQueueInstances();

  await Promise.allSettled(
    queueInstances.map(async (queue) => {
      try {
        await queue.close();
      } catch (error) {
        logger.warn('[Worker] 关闭队列连接失败:', error.message);
      }
    }),
  );

  logger.info('[Worker] 队列消费者已关闭，进程退出');
  process.exit(0);
}

function installSignalHandlers() {
  process.once('SIGINT', () => {
    void closeRegisteredQueues('SIGINT');
  });
  process.once('SIGTERM', () => {
    void closeRegisteredQueues('SIGTERM');
  });
}

async function startWorkerProcess() {
  const processRole = getProcessRole();
  if (!isWorkerRole(processRole)) {
    logger.warn(
      `[Worker] PROCESS_ROLE=${processRole} 不包含 worker，跳过消费者启动`,
    );
    return {
      started: false,
      reason: 'role_not_worker',
      processRole,
    };
  }

  logger.info(`[Worker] 启动队列消费者进程，PROCESS_ROLE=${processRole}`);
  logger.info('[Worker] 当前进程不启动HTTP API与定时调度器');

  validateEnv();

  const dbConnected = await testConnection();
  if (!dbConnected) {
    logger.error('[Worker] 主数据库连接失败，请检查配置');
  }

  const competitorDbConnected = await testCompetitorConnection();
  if (!competitorDbConnected) {
    logger.error('[Worker] 竞品数据库连接失败，请检查配置');
  }

  const registrationResult = registerWorkerProcessors();
  const registrationStatus = getWorkerRegistrationStatus();

  installSignalHandlers();

  logger.info(
    `[Worker] 队列消费者就绪，已注册队列: ${
      registrationStatus.registeredQueues.length > 0
        ? registrationStatus.registeredQueues.join(', ')
        : '无'
    }`,
  );

  return {
    started: true,
    processRole,
    ...registrationResult,
    registrationStatus,
  };
}

if (require.main === module) {
  startWorkerProcess().catch((error) => {
    logger.error('[Worker] 启动失败:', error.message);
    process.exit(1);
  });
}

module.exports = {
  startWorkerProcess,
};
