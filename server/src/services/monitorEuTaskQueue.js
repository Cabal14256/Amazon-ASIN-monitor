const competitorMonitorTaskQueue = require('./competitorMonitorTaskQueue');
const { createMonitorTaskQueue } = require('./monitorTaskQueueFactory');

module.exports = createMonitorTaskQueue({
  name: 'monitor-eu-task-queue',
  followUpQueue: competitorMonitorTaskQueue,
});
