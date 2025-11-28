/**
 * 高峰期工具函数
 * 所有时间基于北京时间（UTC+8）
 */

/**
 * 判断指定时间是否在高峰期
 * @param {Date|string} date - 日期时间（北京时间）
 * @param {string} country - 国家代码 (US, UK, DE, FR, ES, IT)
 * @returns {boolean} 是否在高峰期
 */
function isPeakHour(date, country) {
  const d = typeof date === 'string' ? new Date(date) : date;
  const hour = d.getHours(); // 北京时间的小时数

  switch (country) {
    case 'US':
      // US: 02-05, 09-11 (北京时间)
      return (hour >= 2 && hour < 5) || (hour >= 9 && hour < 11);
    case 'UK':
      // UK: 22-01, 03-05 (北京时间)
      return hour >= 22 || hour < 1 || (hour >= 3 && hour < 5);
    case 'DE':
    case 'FR':
    case 'ES':
    case 'IT':
      // DE/FR/ES/IT: 20-23, 02-04 (北京时间)
      return (hour >= 20 && hour < 23) || (hour >= 2 && hour < 4);
    default:
      return false;
  }
}

/**
 * 获取指定国家的所有高峰期时间段
 * @param {string} country - 国家代码
 * @returns {Array<{start: number, end: number}>} 高峰期时间段数组，每个对象包含start和end小时
 */
function getPeakHours(country) {
  switch (country) {
    case 'US':
      return [
        { start: 2, end: 5 },
        { start: 9, end: 11 },
      ];
    case 'UK':
      return [
        { start: 22, end: 24 },
        { start: 0, end: 1 },
        { start: 3, end: 5 },
      ];
    case 'DE':
    case 'FR':
    case 'ES':
    case 'IT':
      return [
        { start: 20, end: 23 },
        { start: 2, end: 4 },
      ];
    default:
      return [];
  }
}

/**
 * 判断指定时间是否在低峰期（非高峰期）
 * @param {Date|string} date - 日期时间（北京时间）
 * @param {string} country - 国家代码
 * @returns {boolean} 是否在低峰期
 */
function isOffPeakHour(date, country) {
  return !isPeakHour(date, country);
}

/**
 * 获取指定时间段的统计信息
 * @param {Date|string} startTime - 开始时间（北京时间）
 * @param {Date|string} endTime - 结束时间（北京时间）
 * @param {string} country - 国家代码
 * @returns {{peakHours: number, offPeakHours: number, totalHours: number}}
 */
function getTimeRangeStats(startTime, endTime, country) {
  const start = typeof startTime === 'string' ? new Date(startTime) : startTime;
  const end = typeof endTime === 'string' ? new Date(endTime) : endTime;

  let peakHours = 0;
  let offPeakHours = 0;
  const current = new Date(start);

  while (current <= end) {
    if (isPeakHour(current, country)) {
      peakHours++;
    } else {
      offPeakHours++;
    }
    current.setHours(current.getHours() + 1);
  }

  return {
    peakHours,
    offPeakHours,
    totalHours: peakHours + offPeakHours,
  };
}

module.exports = {
  isPeakHour,
  isOffPeakHour,
  getPeakHours,
  getTimeRangeStats,
};
