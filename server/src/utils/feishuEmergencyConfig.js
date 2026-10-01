const DEFAULT_EMERGENCY_CONFIG = Object.freeze({
  enabled: false,
  timeMode: 'rolling',
  windowMinutes: 30,
  startTime: '22:00',
  endTime: '08:00',
  threshold: 10,
  cooldownMinutes: 60,
  userIds: Object.freeze([]),
});

function invalidConfig(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function normalizeEmergencyConfig(value = {}) {
  const input = value === null ? {} : value;
  if (typeof input !== 'object' || Array.isArray(input)) {
    invalidConfig('紧急通知配置必须是对象');
  }
  const result = { ...DEFAULT_EMERGENCY_CONFIG, ...input };
  if (typeof result.enabled !== 'boolean') {
    invalidConfig('紧急通知 enabled 必须是布尔值');
  }
  if (!['rolling', 'daily', 'combined'].includes(result.timeMode)) {
    invalidConfig('紧急通知时间模式无效');
  }
  for (const [field, min, max, label] of [
    ['windowMinutes', 1, 1440, '统计窗口分钟数'],
    ['threshold', 0, 1000000, '新增异常变体组阈值'],
    ['cooldownMinutes', 5, 10080, '电话加急冷却分钟数'],
  ]) {
    if (
      !Number.isInteger(result[field]) ||
      result[field] < min ||
      result[field] > max
    ) {
      invalidConfig(`${label}必须是 ${min} 至 ${max} 的整数`);
    }
  }
  for (const field of ['startTime', 'endTime']) {
    if (
      typeof result[field] !== 'string' ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(result[field])
    ) {
      invalidConfig('紧急通知时段必须使用 HH:mm 格式');
    }
  }
  if (result.timeMode !== 'rolling' && result.startTime === result.endTime) {
    invalidConfig('紧急通知时段的开始时间和结束时间不能相同');
  }
  if (!Array.isArray(result.userIds)) {
    invalidConfig('紧急联系人必须是 open_id 数组');
  }
  const userIds = result.userIds.map((value) => {
    if (
      typeof value !== 'string' ||
      value.trim().length > 128 ||
      !/^ou_[A-Za-z0-9_-]+$/.test(value.trim())
    ) {
      invalidConfig('紧急联系人必须填写有效的飞书 open_id');
    }
    return value.trim();
  });
  result.userIds = [...new Set(userIds)];
  if (result.userIds.length > 10) {
    invalidConfig('紧急联系人最多可设置 10 人');
  }
  if (result.enabled && result.userIds.length === 0) {
    invalidConfig('启用电话加急时至少需要一位紧急联系人');
  }
  return Object.fromEntries(
    Object.keys(DEFAULT_EMERGENCY_CONFIG).map((key) => [key, result[key]]),
  );
}

module.exports = { DEFAULT_EMERGENCY_CONFIG, normalizeEmergencyConfig };
