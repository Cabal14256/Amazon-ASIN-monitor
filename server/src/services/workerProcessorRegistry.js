const logger = require('../utils/logger');
const monitorTaskQueue = require('./monitorTaskQueue');
const competitorMonitorTaskQueue = require('./competitorMonitorTaskQueue');
const exportTaskQueue = require('./exportTaskQueue');
const importTaskQueue = require('./importTaskQueue');
const batchCheckTaskQueue = require('./batchCheckTaskQueue');
const backupTaskQueue = require('./backupTaskQueue');

const queueRegistrations = [
  { name: 'monitor', module: monitorTaskQueue },
  { name: 'competitor', module: competitorMonitorTaskQueue },
  { name: 'export', module: exportTaskQueue },
  { name: 'import', module: importTaskQueue },
  { name: 'batchCheck', module: batchCheckTaskQueue },
  { name: 'backup', module: backupTaskQueue },
];

function registerWorkerProcessors() {
  const newlyRegisteredQueues = [];

  queueRegistrations.forEach(({ name, module }) => {
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

  return {
    registeredQueues,
    newlyRegisteredQueues,
  };
}

function getRegisteredQueueNames() {
  return queueRegistrations
    .filter(({ module }) => module.getProcessorStatus().registered)
    .map(({ name }) => name);
}

function getWorkerRegistrationStatus() {
  const details = {};
  queueRegistrations.forEach(({ name, module }) => {
    details[name] = module.getProcessorStatus();
  });

  const registeredQueues = Object.keys(details).filter(
    (name) => details[name].registered,
  );

  return {
    registeredQueues,
    details,
  };
}

function getRegisteredQueueInstances() {
  return queueRegistrations
    .filter(({ module }) => module.getProcessorStatus().registered)
    .map(({ module }) => module.queue);
}

module.exports = {
  registerWorkerProcessors,
  getRegisteredQueueNames,
  getWorkerRegistrationStatus,
  getRegisteredQueueInstances,
};
