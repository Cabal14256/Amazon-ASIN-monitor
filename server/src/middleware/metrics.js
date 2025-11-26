const metricsService = require('../services/metricsService');

function metricsMiddleware(req, res, next) {
  const start = process.hrtime();
  res.on('finish', () => {
    const [seconds, nanoseconds] = process.hrtime(start);
    const durationSec = seconds + nanoseconds / 1e9;
    const route = req.route ? req.route.path : req.path;
    metricsService.recordHttpRequest({
      method: req.method,
      route,
      status: res.statusCode,
      durationSec,
    });
  });
  next();
}

module.exports = metricsMiddleware;
