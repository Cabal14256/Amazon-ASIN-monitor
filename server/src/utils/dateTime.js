/**
 * 时间工具函数
 * 所有时间格式化为 UTC+8 (中国时区)
 */

const UTC8_TIMEZONE = 'Asia/Shanghai';
const UTC8_OFFSET = '+08:00';
const UTC8_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: UTC8_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  hourCycle: 'h23',
});

function normalizeDate(value = new Date()) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? new Date() : value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}

function getUTC8Parts(input = new Date()) {
  const date = normalizeDate(input);
  const parts = UTC8_FORMATTER.formatToParts(date);
  const map = {};

  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }

  return {
    date,
    year: map.year,
    month: map.month,
    day: map.day,
    hours: map.hour,
    minutes: map.minute,
    seconds: map.second,
    milliseconds: String(date.getMilliseconds()).padStart(3, '0'),
  };
}

/**
 * 获取 UTC+8 时区的当前时间字符串（ISO 格式）
 * @returns {string} UTC+8 时区的 ISO 格式时间字符串
 */
function getUTC8ISOString() {
  const { year, month, day, hours, minutes, seconds, milliseconds } =
    getUTC8Parts();
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${UTC8_OFFSET}`;
}

/**
 * 获取 UTC+8 时区的当前时间字符串（自定义格式）
 * @param {string} format - 格式字符串，例如 'YYYY-MM-DD HH:mm:ss'
 * @returns {string} 格式化后的时间字符串
 */
function getUTC8String(format = 'YYYY-MM-DD HH:mm:ss') {
  const { year, month, day, hours, minutes, seconds, milliseconds } =
    getUTC8Parts();

  return format
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds)
    .replace('SSS', milliseconds);
}

/**
 * 将 Date 对象转换为 UTC+8 时区的 ISO 字符串
 * @param {Date|string|number} date - Date 对象或可解析日期值
 * @returns {string} UTC+8 时区的 ISO 格式时间字符串
 */
function toUTC8ISOString(date) {
  const { year, month, day, hours, minutes, seconds, milliseconds } =
    getUTC8Parts(date);
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${UTC8_OFFSET}`;
}

/**
 * 获取 UTC+8 时区的当前 Date 对象
 * @returns {Date} UTC+8 时区时间点对应的 Date 对象
 */
function getUTC8Date() {
  return normalizeDate(getUTC8ISOString());
}

/**
 * 获取 UTC+8 时区的本地化时间字符串（中文格式）
 * @param {Date|string|number} date - Date 对象或可解析日期值，默认为当前时间
 * @returns {string} 本地化时间字符串，例如 '2024-01-01 12:00:00'
 */
function getUTC8LocaleString(date = new Date()) {
  const { year, month, day, hours, minutes, seconds } = getUTC8Parts(date);
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

module.exports = {
  getUTC8ISOString,
  getUTC8String,
  toUTC8ISOString,
  getUTC8Date,
  getUTC8LocaleString,
};
