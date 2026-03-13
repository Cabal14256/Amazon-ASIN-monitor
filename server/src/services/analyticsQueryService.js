module.exports = {
  ...require('./analyticsQuery/overviewQuery'),
  ...require('./analyticsQuery/distributionQuery'),
  ...require('./analyticsQuery/periodSummaryQuery'),
  ...require('./analyticsQuery/summaryQuery'),
  ...require('./analyticsQuery/timeSeriesQuery'),
};
