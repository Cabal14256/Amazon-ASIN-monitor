const logger = require('../utils/logger');
const monitorTaskQueue = require('./monitorTaskQueue');
const monitorEuTaskQueue = require('./monitorEuTaskQueue');
const competitorMonitorTaskQueue = require('./competitorMonitorTaskQueue');
const exportTaskQueue = require('./exportTaskQueue');
const importTaskQueue = require('./importTaskQueue');
const batchCheckTaskQueue = require('./batchCheckTaskQueue');
const batchDeleteTaskQueue = require('./batchDeleteTaskQueue');
const backupTaskQueue = require('./backupTaskQueue');
const variantCheckTaskQueue = require('./variantCheckTaskQueue');
const { startQueueConnectionWatchdog } = require('./queueConnectionWatchdog');
const { getWorkerQueueConfig, isQueueEnabled } = require('./workerQueueConfig');

let workerQueueWatchdog = null;

const queueRegistrations = [
  {
    name: 'monitor',
    aliases: ['monitor', 'monitor-us', 'monitorus'],
    module: monitorTaskQueue,
  },
  {
    name: 'monitorEu',
    aliases: ['monitor-eu', 'monitoreu'],
    module: monitorEuTaskQueue,
  },
  {
    name: 'competitor',
    aliases: ['competitor'],
    module: competitorMonitorTaskQueue,
  },
  {
    name: 'export',
    aliases: ['export'],
    module: exportTaskQueue,
  },
  {
    name: 'import',
    aliases: ['import'],
    module: importTaskQueue,
  },
  {
    name: 'batchCheck',
    aliases: ['batchcheck', 'batch-check'],
    module: batchCheckTaskQueue,
  },
  {
    name: 'batchDelete',
    aliases: ['batchdelete', 'batch-delete'],
    module: batchDeleteTaskQueue,
  },
  {
    name: 'backup',
    aliases: ['backup'],
    module: backupTaskQueue,
  },
  {
    name: 'variantCheck',
    aliases: ['variantcheck', 'variant-check'],
    module: variantCheckTaskQueue,
  },
];

function getConfiguredWorkerQueueConfig() {
  return getWorkerQueueConfig(queueRegistrations);
}

function isRegisteredQueueEnabled(
  name,
  config = getConfiguredWorkerQueueConfig(),
) {
  return isQueueEnabled(name, config);
}

function registerWorkerProcessors() {
  const newlyRegisteredQueues = [];
  const skippedQueues = [];
  const config = getConfiguredWorkerQueueConfig();

  if (config.unknownQueues.length > 0) {
    logger.warn(
      `[Worker] WORKER_ENABLED_QUEUES 包含未知队列名: ${config.unknownQueues.join(
        ', ',
      )}`,
    );
  }

  queueRegistrations.forEach(({ name, module }) => {
    if (!isRegisteredQueueEnabled(name, config)) {
      skippedQueues.push(name);
      return;
    }

    const didRegister = module.registerProcessor();
    if (didRegister) {
      newlyRegisteredQueues.push(name);
    }
  });

  const registeredQueues = getRegisteredQueueNames();
  logger.info(
    `[Worker] 队列处理器注册完成，当前已注册: ${
      registeredQueues.length > 0 ? registeredQueues.join(', ') : '无'
    }`,
  );
  if (skippedQueues.length > 0) {
    logger.info(
      `[Worker] 根据 WORKER_ENABLED_QUEUES 跳过队列: ${skippedQueues.join(
        ', ',
      )}`,
    );
  }
  const watchdogStarted = startWorkerQueueWatchdog();

  return {
    registeredQueues,
    newlyRegisteredQueues,
    skippedQueues,
    enabledQueues: config.enabledQueues,
    watchdogStarted,
  };
}

function getRegisteredQueueNames() {
  return queueRegistrations
    .filter(({ module }) => module.getProcessorStatus().registered)
    .map(({ name }) => name);
}

function getWorkerRegistrationStatus() {
  const config = getConfiguredWorkerQueueConfig();
  const details = {};
  queueRegistrations.forEach(({ name, module }) => {
    details[name] = {
      ...module.getProcessorStatus(),
      enabledByConfig: isRegisteredQueueEnabled(name, config),
    };
  });

  const registeredQueues = Object.keys(details).filter(
    (name) => details[name].registered,
  );

  return {
    registeredQueues,
    enabledQueues: config.enabledQueues,
    skippedQueues: queueRegistrations
      .map(({ name }) => name)
      .filter((name) => !isRegisteredQueueEnabled(name, config)),
    details,
  };
}

function getRegisteredQueueInstances() {
  return queueRegistrations
    .filter(({ module }) => module.getProcessorStatus().registered)
    .map(({ module }) => module.queue);
}

function startWorkerQueueWatchdog() {
  if (workerQueueWatchdog) {
    return false;
  }

  const queueInstances = getRegisteredQueueInstances();
  if (queueInstances.length === 0) {
    return false;
  }

  workerQueueWatchdog = startQueueConnectionWatchdog(queueInstances, {
    scope: 'Worker',
    checkBacklogProgress: true,
    // Queue age is not a liveness signal: SP-API retries and quota waits can
    // legitimately keep a job active for longer than the old 20-minute limit.
    checkActiveJobAge: ['1', 'true', 'yes', 'on'].includes(
      String(process.env.QUEUE_WATCHDOG_CHECK_ACTIVE_JOB_AGE || '')
        .trim()
        .toLowerCase(),
    ),
    onUnhealthy: () => {
      process.exit(1);
    },
  });
  return true;
}

function stopWorkerQueueWatchdog() {
  if (!workerQueueWatchdog) {
    return false;
  }
  workerQueueWatchdog.stop();
  workerQueueWatchdog = null;
  return true;
}

module.exports = {
  registerWorkerProcessors,
  getRegisteredQueueNames,
  getWorkerRegistrationStatus,
  getRegisteredQueueInstances,
  getWorkerQueueConfig: getConfiguredWorkerQueueConfig,
  startWorkerQueueWatchdog,
  stopWorkerQueueWatchdog,
};
