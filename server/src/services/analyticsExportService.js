const analyticsService = require('./analyticsService');

function toNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

async function buildMonthlyBreakdownExportData(params = {}) {
  const { country = '' } = params;
  const window = analyticsService.resolveMonthlyWindow(params);
  const result = await analyticsService.getMonthlyBreakdown({
    country,
    month: window.monthToken,
    startTime: window.startTime,
    endTime: window.endTime,
  });

  const breakdown = result?.data ?? result ?? {};
  const rows = Array.isArray(breakdown?.rows) ? breakdown.rows : [];
  const summary =
    breakdown?.summary && typeof breakdown.summary === 'object'
      ? breakdown.summary
      : {
          abnormalDurationTotal: 0,
          totalDurationTotal: 0,
          averageRatio: 0,
        };

  const [yearText, monthText] = window.monthToken.split('-');
  const year = Number(yearText) || new Date().getFullYear();
  const monthNumber = Math.min(12, Math.max(1, Number(monthText) || 1));
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const rowByDay = new Map(
    rows
      .map((row) => [Number(row?.day), row])
      .filter(([day]) => Number.isInteger(day) && day > 0),
  );

  const excelData = [
    ['日期', '异常时长（小时）', '总监控时长（小时）', '异常时长占比'],
  ];

  for (let day = 1; day <= daysInMonth; day += 1) {
    const row = rowByDay.get(day) || {
      day,
      abnormalDurationHours: 0,
      totalDurationHours: 0,
      abnormalDurationRate: 0,
    };

    excelData.push([
      row.day,
      Number(toNumber(row.abnormalDurationHours).toFixed(2)),
      Number(toNumber(row.totalDurationHours).toFixed(2)),
      `${toNumber(row.abnormalDurationRate).toFixed(2)}%`,
    ]);
  }

  excelData.push([
    '总体异常时长占比',
    Number(toNumber(summary.abnormalDurationTotal).toFixed(2)),
    Number(toNumber(summary.totalDurationTotal).toFixed(2)),
    `${toNumber(summary.averageRatio).toFixed(2)}%`,
  ]);

  return {
    breakdown: {
      rows,
      summary,
    },
    columnWidths: [12, 12, 14, 12],
    excelData,
    filename: `月度异常时长统计_${window.monthToken}.xlsx`,
    monthToken: window.monthToken,
    sheetName: '月度异常时长统计',
  };
}

module.exports = {
  buildMonthlyBreakdownExportData,
};
