// backend/scripts/run-once.js
(async () => {
  try {
    const { monitorAsinsOnce } = require('../services/variantMonitor');
    console.log('>>> run monitor once (US + EU)');
    await monitorAsinsOnce();
    console.log('>>> done');
    process.exit(0);
  } catch (e) {
    console.error('run-once error:', e);
    process.exit(1);
  }
})();
