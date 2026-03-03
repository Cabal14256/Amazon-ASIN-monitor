import dayjs, { type ConfigType, type Dayjs } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

export const BEIJING_TIMEZONE = 'Asia/Shanghai';

const HAS_TIMEZONE_SUFFIX = /(Z|[+-]\d{2}:?\d{2})$/i;
const LOCAL_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)?$/;

function normalizeDateTimeString(value: string): string {
  return value.trim().replace('T', ' ');
}

export function toBeijingDayjs(value?: ConfigType): Dayjs {
  if (value === undefined || value === null || value === '') {
    return dayjs().tz(BEIJING_TIMEZONE);
  }

  if (typeof value === 'string') {
    const normalized = normalizeDateTimeString(value);
    if (!normalized) {
      return dayjs().tz(BEIJING_TIMEZONE);
    }

    if (HAS_TIMEZONE_SUFFIX.test(normalized)) {
      return dayjs(normalized).tz(BEIJING_TIMEZONE);
    }

    if (LOCAL_DATETIME_PATTERN.test(normalized)) {
      return dayjs.tz(normalized, BEIJING_TIMEZONE);
    }

    return dayjs(normalized).tz(BEIJING_TIMEZONE);
  }

  return dayjs(value).tz(BEIJING_TIMEZONE);
}

export function formatBeijing(
  value: ConfigType,
  format = 'YYYY-MM-DD HH:mm:ss',
): string {
  return toBeijingDayjs(value).format(format);
}

export function formatBeijingNow(format = 'YYYY-MM-DD HH:mm:ss'): string {
  return toBeijingDayjs().format(format);
}

export function formatBeijingDate(value: ConfigType): string {
  return formatBeijing(value, 'YYYY-MM-DD');
}
