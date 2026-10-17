const competitorMonitorTaskQueue = require('./competitorMonitorTaskQueue');
const { createMonitorTaskQueue } = require('./monitorTaskQueueFactory');

module.exports = createMonitorTaskQueue({
  name: 'monitor-task-queue',
  followUpQueue: competitorMonitorTaskQueue,
});
