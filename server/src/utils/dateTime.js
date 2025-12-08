/**
 * 时间工具函数
 * 所有时间格式化为 UTC+8 (中国时区)
 */

/**
 * 获取 UTC+8 时区的当前时间字符串（ISO 格式）
 * @returns {string} UTC+8 时区的 ISO 格式时间字符串
 */
function getUTC8ISOString() {
  const now = new Date();
  // 获取 UTC 时间戳（毫秒）
  const utcTime = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  // 加上 8 小时（UTC+8）
  const utc8Time = new Date(utcTime + 8 * 60 * 60 * 1000);

  // 手动格式化为 ISO 字符串（UTC+8）
  const year = utc8Time.getUTCFullYear();
  const month = String(utc8Time.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utc8Time.getUTCDate()).padStart(2, '0');
  const hours = String(utc8Time.getUTCHours()).padStart(2, '0');
  const minutes = String(utc8Time.getUTCMinutes()).padStart(2, '0');
  const seconds = String(utc8Time.getUTCSeconds()).padStart(2, '0');
  const milliseconds = String(utc8Time.getUTCMilliseconds()).padStart(3, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}+08:00`;
}

/**
 * 获取 UTC+8 时区的当前时间字符串（自定义格式）
 * @param {string} format - 格式字符串，例如 'YYYY-MM-DD HH:mm:ss'
 * @returns {string} 格式化后的时间字符串
 */
function getUTC8String(format = 'YYYY-MM-DD HH:mm:ss') {
  const now = new Date();
  const utcTime = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  const utc8Time = new Date(utcTime + 8 * 60 * 60 * 1000);

  const year = utc8Time.getUTCFullYear();
  const month = String(utc8Time.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utc8Time.getUTCDate()).padStart(2, '0');
  const hours = String(utc8Time.getUTCHours()).padStart(2, '0');
  const minutes = String(utc8Time.getUTCMinutes()).padStart(2, '0');
  const seconds = String(utc8Time.getUTCSeconds()).padStart(2, '0');
  const milliseconds = String(utc8Time.getUTCMilliseconds()).padStart(3, '0');

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
 * @param {Date} date - Date 对象
 * @returns {string} UTC+8 时区的 ISO 格式时间字符串
 */
function toUTC8ISOString(date) {
  const dateObj = date instanceof Date ? date : new Date(date);
  const utcTime = dateObj.getTime() + dateObj.getTimezoneOffset() * 60 * 1000;
  const utc8Time = new Date(utcTime + 8 * 60 * 60 * 1000);

  // 手动格式化为 ISO 字符串（UTC+8）
  const year = utc8Time.getUTCFullYear();
  const month = String(utc8Time.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utc8Time.getUTCDate()).padStart(2, '0');
  const hours = String(utc8Time.getUTCHours()).padStart(2, '0');
  const minutes = String(utc8Time.getUTCMinutes()).padStart(2, '0');
  const seconds = String(utc8Time.getUTCSeconds()).padStart(2, '0');
  const milliseconds = String(utc8Time.getUTCMilliseconds()).padStart(3, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}+08:00`;
}

/**
 * 获取 UTC+8 时区的当前 Date 对象
 * @returns {Date} UTC+8 时区的 Date 对象
 */
function getUTC8Date() {
  const now = new Date();
  const utcTime = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  return new Date(utcTime + 8 * 60 * 60 * 1000);
}

/**
 * 获取 UTC+8 时区的本地化时间字符串（中文格式）
 * @param {Date} date - Date 对象，默认为当前时间
 * @returns {string} 本地化时间字符串，例如 '2024-01-01 12:00:00'
 */
function getUTC8LocaleString(date = new Date()) {
  const dateObj = date instanceof Date ? date : new Date(date);
  const utcTime = dateObj.getTime() + dateObj.getTimezoneOffset() * 60 * 1000;
  const utc8Time = new Date(utcTime + 8 * 60 * 60 * 1000);

  const year = utc8Time.getUTCFullYear();
  const month = String(utc8Time.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utc8Time.getUTCDate()).padStart(2, '0');
  const hours = String(utc8Time.getUTCHours()).padStart(2, '0');
  const minutes = String(utc8Time.getUTCMinutes()).padStart(2, '0');
  const seconds = String(utc8Time.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

module.exports = {
  getUTC8ISOString,
  getUTC8String,
  toUTC8ISOString,
  getUTC8Date,
  getUTC8LocaleString,
};
