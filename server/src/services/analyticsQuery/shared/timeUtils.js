function alignTimeToSlotText(value, granularity) {
  if (!value) {
    return '';
  }

  const normalized = String(value).trim().replace('T', ' ');
  const datePart = normalized.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return '';
  }

  if (granularity === 'day') {
    return `${datePart} 00:00:00`;
  }

  const hourPart = normalized.length >= 13 ? normalized.slice(11, 13) : '00';
  if (!/^\d{2}$/.test(hourPart)) {
    return '';
  }

  return `${datePart} ${hourPart}:00:00`;
}

function formatDateToSqlText(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function clampValue(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function parseDateTimeInput(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const normalized = String(value).trim().replace('T', ' ');
  if (!normalized) {
    return null;
  }

  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (match) {
    const [, year, month, day, hour = '00', minute = '00', second = '00'] =
      match;
    const parsed = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      0,
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateToDayText(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateToMonthText(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

function formatDateToHourText(date) {
  return `${formatDateToSqlText(date).slice(0, 13)}:00:00`;
}

function getISOWeekInfo(date) {
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const dayNumber = (target.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNumber + 3);

  const isoYear = target.getFullYear();
  const firstThursday = new Date(isoYear, 0, 4);
  firstThursday.setHours(0, 0, 0, 0);
  const firstDayNumber = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNumber + 3);

  const week =
    1 + Math.round((target - firstThursday) / (7 * 24 * 3600 * 1000));
  return { year: isoYear, week };
}

function formatISOWeekTextFromDate(date) {
  const { year, week } = getISOWeekInfo(date);
  return `${year}-${String(week).padStart(2, '0')}`;
}

function getISOWeekStartDate(year, week) {
  const jan4 = new Date(year, 0, 4, 0, 0, 0, 0);
  const jan4Day = jan4.getDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4Day + 1);
  week1Monday.setHours(0, 0, 0, 0);

  const weekStart = new Date(week1Monday);
  weekStart.setDate(week1Monday.getDate() + (week - 1) * 7);
  return weekStart;
}

function getBucketRangeByPeriod(timePeriod, granularity) {
  const period = String(timePeriod || '').trim();
  if (!period) {
    return { bucketStart: null, bucketEnd: null };
  }

  let bucketStart = null;
  let bucketEnd = null;

  if (granularity === 'hour') {
    bucketStart = parseDateTimeInput(period);
    if (bucketStart) {
      bucketEnd = new Date(bucketStart);
      bucketEnd.setHours(bucketEnd.getHours() + 1);
    }
  } else if (granularity === 'day') {
    bucketStart = parseDateTimeInput(`${period} 00:00:00`);
    if (bucketStart) {
      bucketEnd = new Date(bucketStart);
      bucketEnd.setDate(bucketEnd.getDate() + 1);
    }
  } else if (granularity === 'week') {
    const match = period.match(/^(\d{4})-(\d{2})$/);
    if (match) {
      const year = Number(match[1]);
      const week = Number(match[2]);
      bucketStart = getISOWeekStartDate(year, week);
      bucketEnd = new Date(bucketStart);
      bucketEnd.setDate(bucketEnd.getDate() + 7);
    }
  }

  return { bucketStart, bucketEnd };
}

function calculateOverlapHours(bucketStart, bucketEnd, queryStart, queryEnd) {
  if (!bucketStart || !bucketEnd || !queryStart || !queryEnd) {
    return 0;
  }

  const overlapStart = Math.max(bucketStart.getTime(), queryStart.getTime());
  const overlapEnd = Math.min(bucketEnd.getTime(), queryEnd.getTime());
  if (overlapEnd <= overlapStart) {
    return 0;
  }

  return (overlapEnd - overlapStart) / (1000 * 60 * 60);
}

function buildQueryTimeRangeText(startTime, endTime) {
  const normalizedStart = String(startTime || '').trim();
  const normalizedEnd = String(endTime || '').trim();
  if (normalizedStart && normalizedEnd) {
    return `${normalizedStart} ~ ${normalizedEnd}`;
  }

  return normalizedStart || normalizedEnd || '-';
}

module.exports = {
  alignTimeToSlotText,
  buildQueryTimeRangeText,
  calculateOverlapHours,
  clampValue,
  formatDateToDayText,
  formatDateToHourText,
  formatDateToMonthText,
  formatDateToSqlText,
  formatISOWeekTextFromDate,
  getBucketRangeByPeriod,
  getISOWeekStartDate,
  parseDateTimeInput,
};
