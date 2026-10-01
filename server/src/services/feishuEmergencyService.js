const { randomUUID } = require('node:crypto');
const FeishuConfig = require('../models/FeishuConfig');
const { normalizeEmergencyConfig } = require('../utils/feishuEmergencyConfig');
const { getEmergencyWindow } = require('../utils/feishuEmergencyWindow');
const { sendUrgentPhoneNotifications } = require('./feishuUrgentService');
const logger = require('../utils/logger');

async function assessEmergency(region, now = new Date()) {
  try {
    const row = await FeishuConfig.findByRegion(region);
    if (!row || !row.enabled) return { status: 'disabled' };
    const config = normalizeEmergencyConfig(
      typeof row.emergency_config === 'string'
        ? JSON.parse(row.emergency_config)
        : row.emergency_config || {},
    );
    if (!config.enabled) return { status: 'disabled' };
    const window = getEmergencyWindow(config, now);
    if (!window) return { status: 'outside_time_range' };
    const { count, maxEventId } = await FeishuConfig.getEmergencyGroups(
      region,
      window.startTime,
      window.endTime,
    );
    const summary = {
      region,
      count,
      threshold: config.threshold,
      maxEventId,
      ...window,
    };
    if (count <= config.threshold) return { ...summary, status: 'normal' };
    logger.warn('飞书新增异常变体组数量超过紧急阈值', summary);
    return { ...summary, status: 'emergency', config };
  } catch {
    // Database driver errors can contain SQL values, including contact IDs.
    logger.error('飞书紧急状态评估失败，请检查配置和数据库迁移');
    return { status: 'assessment_failed' };
  }
}

async function notifyEmergency(assessment) {
  if (assessment.status !== 'emergency') {
    return { status: assessment.status };
  }
  const { config, region, count, threshold, startTime, endTime, maxEventId } =
    assessment;
  try {
    if (
      !process.env.FEISHU_APP_ID?.trim() ||
      !process.env.FEISHU_APP_SECRET?.trim()
    ) {
      logger.error('飞书电话加急未发送：应用凭据未配置', { region });
      return { status: 'credentials_missing' };
    }
    // Reserve before any outbound request. Ambiguous timeouts also consume the
    // cooldown, so concurrent workers and retries cannot repeatedly dial users.
    if (
      !(await FeishuConfig.claimEmergency(region, config.cooldownMinutes, {
        startTime,
        endTime,
        maxEventId,
        rule: config,
      }))
    ) {
      return { status: 'cooldown' };
    }
    const text = [
      `【紧急】${region} 区域新增异常变体组，请尽快处理`,
      `统计时间（北京时间）：${startTime} 至 ${endTime}`,
      `新增异常变体组数：${count}，超过阈值：${threshold}`,
      '按国家 + 变体组去重，仅统计当前关系健康状态由正常转为关系丢失或成功查询确认父 ASIN 标题为空的新增事件。',
      '历史父体变化单独记录，不计入紧急状态。标题查询失败或超时暂不判定；持续异常、人工标记、API 错误和已尝试电话通知的事件不重复计入。',
    ].join('\n');
    const result = await sendUrgentPhoneNotifications({
      userIds: config.userIds,
      text,
      requestId: randomUUID(),
    });
    const status = result.success
      ? 'sent'
      : result.sent > 0
      ? 'partial'
      : 'failed';
    logger[result.success ? 'info' : 'error']('飞书电话加急处理完成', {
      region,
      status,
      sent: result.sent,
      failed: result.failed,
    });
    return { status, sent: result.sent, failed: result.failed };
  } catch {
    logger.error('飞书电话加急处理失败', { region });
    return { status: 'failed' };
  }
}

module.exports = { assessEmergency, notifyEmergency };
