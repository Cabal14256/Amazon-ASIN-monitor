/**
 * Analytics Query Service
 * 聚合所有 analytics 查询模块的统一出口
 */

const {
  getOverallStatistics,
  getPeakHoursStatistics,
} = require('./analyticsQuery/overviewQuery');
const { getStatisticsByTime } = require('./analyticsQuery/timeSeriesQuery');
const {
  getASINStatisticsByCountry,
  getASINStatisticsByVariantGroup,
} = require('./analyticsQuery/distributionQuery');
const {
  getAllCountriesSummary,
  getRegionSummary,
} = require('./analyticsQuery/summaryQuery');
const {
  getPeriodSummary,
  getPeriodSummaryTimeSlotDetails,
} = require('./analyticsQuery/periodSummaryQuery');

module.exports = {
  // Overview 查询
  getOverallStatistics,
  getPeakHoursStatistics,

  // 时间序列查询
  getStatisticsByTime,

  // 分布查询
  getASINStatisticsByCountry,
  getASINStatisticsByVariantGroup,

  // 汇总查询
  getAllCountriesSummary,
  getRegionSummary,

  // 周期汇总查询
  getPeriodSummary,
  getPeriodSummaryTimeSlotDetails,
};
