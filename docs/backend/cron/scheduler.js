const cron = require('node-cron');
const { checkAllAsins } = require('../services/asinMonitor');

function start() {
  cron.schedule('0 * * * *', () => {
    console.log("Running hourly ASIN check...");
    checkAllAsins();
  });
}

module.exports = { start };
