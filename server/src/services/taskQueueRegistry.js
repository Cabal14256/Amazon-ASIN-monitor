const exportTaskQueue = require('./exportTaskQueue');
const importTaskQueue = require('./importTaskQueue');
const batchCheckTaskQueue = require('./batchCheckTaskQueue');
const backupTaskQueue = require('./backupTaskQueue');

const TASK_QUEUE_MAP = {
  export: exportTaskQueue,
  import: importTaskQueue,
  'batch-check': batchCheckTaskQueue,
  backup: backupTaskQueue,
};

function getQueueByTaskType(taskType) {
  return TASK_QUEUE_MAP[taskType] || null;
}

module.exports = {
  getQueueByTaskType,
};
