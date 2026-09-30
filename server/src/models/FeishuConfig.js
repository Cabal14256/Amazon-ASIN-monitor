const { pool, withTransaction } = require('../config/database');
const { normalizeEmergencyConfig } = require('../utils/feishuEmergencyConfig');
const logger = require('../utils/logger');

// 配置包含 webhook 与联系人，数据库错误不得输出带绑定参数的原始 SQL。
async function query(sql, params = [], runner = pool) {
  try {
    const [rows] = await runner.query({ sql, values: params, timeout: 10000 });
    return rows;
  } catch (error) {
    logger.error('飞书配置数据库操作失败', {
      code: /^[A-Z0-9_]+$/.test(error.code || '')
        ? error.code
        : 'DATABASE_ERROR',
    });
    throw new Error('飞书配置数据库操作失败');
  }
}

const REGION_COUNTRIES = {
  US: ['US'],
  EU: ['UK', 'DE', 'FR', 'IT', 'ES'],
};

function requireRegion(region) {
  if (!Object.prototype.hasOwnProperty.call(REGION_COUNTRIES, region)) {
    const error = new Error('飞书配置区域必须是 US 或 EU');
    error.status = 400;
    throw error;
  }
  return REGION_COUNTRIES[region];
}

function getEmergencyConfig(row) {
  const value = row?.emergency_config;
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error('已存储的紧急通知配置格式无效');
    }
  }
  return normalizeEmergencyConfig(parsed);
}

function toPublicConfig(row) {
  if (!row) return null;
  return {
    id: row.id,
    country: row.country,
    webhookUrl: row.webhook_url,
    enabled: row.enabled,
    emergency: getEmergencyConfig(row),
    createTime: row.create_time,
    updateTime: row.update_time,
  };
}

function emergencyEventFilter(countries, bounded = false) {
  return `e.country IN (${countries.map(() => '?').join(', ')})
    AND e.occurred_at >= ? AND e.occurred_at <= ?
    ${bounded ? 'AND e.id <= ?' : ''}
    AND e.phone_attempted_at IS NULL
    AND e.notify_enabled = 1
    AND COALESCE(vg.feishu_notify_enabled, 1) <> 0
    AND EXISTS (
      SELECT 1 FROM asins a
      WHERE a.variant_group_id = e.variant_group_id
        AND a.country = e.country
        AND COALESCE(a.feishu_notify_enabled, 1) <> 0
        AND JSON_CONTAINS(e.details, JSON_QUOTE(a.id), '$.triggerAsinIds') = 1
    )`;
}

class FeishuConfig {
  // 查询所有飞书配置（只返回US和EU）
  static async findAll() {
    const list = await query(
      `SELECT * FROM feishu_config WHERE country IN ('US', 'EU') ORDER BY country ASC`,
    );
    // 转换字段名为驼峰命名
    return list.map(toPublicConfig);
  }

  // 根据国家查询配置（映射到区域）
  static async findByCountry(country) {
    const region = ['UK', 'DE', 'FR', 'IT', 'ES'].includes(country)
      ? 'EU'
      : country;
    requireRegion(region);

    const [config] = await query(
      `SELECT * FROM feishu_config WHERE country = ?`,
      [region],
    );
    return toPublicConfig(config);
  }

  // 根据区域查询配置
  static async findByRegion(region) {
    requireRegion(region);
    const [config] = await query(
      `SELECT * FROM feishu_config WHERE country = ? AND enabled = 1`,
      [region],
    );
    return config || null;
  }

  // 创建或更新配置
  static async upsert(data) {
    const { country, webhookUrl, enabled = 1 } = data;
    requireRegion(country);
    const hasEmergency = Object.prototype.hasOwnProperty.call(
      data,
      'emergency',
    );
    const emergency = hasEmergency
      ? normalizeEmergencyConfig(data.emergency)
      : null;
    if (
      emergency?.enabled &&
      (!process.env.FEISHU_APP_ID?.trim() ||
        !process.env.FEISHU_APP_SECRET?.trim())
    ) {
      const error = new Error(
        '启用电话加急前请配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET',
      );
      error.status = 400;
      throw error;
    }

    // 检查是否已存在（不检查 enabled 状态）
    const [existing] = await query(
      `SELECT * FROM feishu_config WHERE country = ?`,
      [country],
    );

    if (existing) {
      // 更新
      if (hasEmergency) {
        await query(
          `UPDATE feishu_config SET webhook_url = ?, enabled = ?, emergency_config = ?, update_time = NOW() WHERE country = ?`,
          [webhookUrl, enabled ? 1 : 0, JSON.stringify(emergency), country],
        );
      } else {
        await query(
          `UPDATE feishu_config SET webhook_url = ?, enabled = ?, update_time = NOW() WHERE country = ?`,
          [webhookUrl, enabled ? 1 : 0, country],
        );
      }
    } else {
      // 创建
      await query(
        `INSERT INTO feishu_config (country, webhook_url, enabled, emergency_config) VALUES (?, ?, ?, ?)`,
        [
          country,
          webhookUrl,
          enabled ? 1 : 0,
          emergency ? JSON.stringify(emergency) : null,
        ],
      );
    }

    // 返回更新后的配置（不检查 enabled 状态）
    return this.findByCountry(country);
  }

  // 删除配置
  static async delete(country) {
    requireRegion(country);
    await query(`DELETE FROM feishu_config WHERE country = ?`, [country]);
    return true;
  }

  // 启用/禁用配置
  static async toggleEnabled(country, enabled) {
    requireRegion(country);
    await query(
      `UPDATE feishu_config SET enabled = ?, update_time = NOW() WHERE country = ?`,
      [enabled ? 1 : 0, country],
    );
    return this.findByCountry(country);
  }

  static async getEmergencyGroups(region, startTimeSql, endTimeSql) {
    const countries = requireRegion(region);
    const [result] = await query(
      `SELECT COUNT(DISTINCT e.country, e.variant_group_id) AS group_count,
              CAST(MAX(e.id) AS CHAR) AS max_event_id
       FROM variant_group_split_events e
       INNER JOIN variant_groups vg
         ON vg.id = e.variant_group_id AND vg.country = e.country
       WHERE ${emergencyEventFilter(countries)}`,
      [...countries, startTimeSql, endTimeSql],
    );
    return {
      count: Number(result?.group_count) || 0,
      maxEventId:
        result?.max_event_id == null ? null : String(result.max_event_id),
    };
  }

  static async countEmergencyGroups(region, startTimeSql, endTimeSql) {
    const result = await this.getEmergencyGroups(
      region,
      startTimeSql,
      endTimeSql,
    );
    return result.count;
  }

  static async claimEmergency(region, cooldownMinutes, options = {}) {
    const countries = requireRegion(region);
    const { cooldownMinutes: validatedCooldown } = normalizeEmergencyConfig({
      cooldownMinutes,
    });
    // An incomplete assessment must never consume events or reserve a call.
    if (
      !options.startTime ||
      !options.endTime ||
      !options.rule ||
      !/^[1-9]\d*$/.test(String(options.maxEventId ?? ''))
    )
      return false;
    const expectedRule = normalizeEmergencyConfig(options.rule);
    const eventParams = [
      ...countries,
      options.startTime,
      options.endTime,
      String(options.maxEventId),
    ];

    return withTransaction(async ({ connection }) => {
      // Use the sanitized query wrapper even inside a transaction: configuration
      // driver errors can contain webhook URLs or contact IDs in bound values.
      const execute = (sql, params) => query(sql, params, connection);
      const [row] = await execute(
        `SELECT *, (last_emergency_at IS NULL OR
          last_emergency_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)) AS cooldown_ready
         FROM feishu_config WHERE country = ? FOR UPDATE`,
        [validatedCooldown, region],
      );
      if (!row || Number(row.enabled) !== 1 || !Number(row.cooldown_ready))
        return false;
      const currentRule = getEmergencyConfig(row);
      if (
        !currentRule.enabled ||
        currentRule.cooldownMinutes !== validatedCooldown ||
        JSON.stringify(currentRule) !== JSON.stringify(expectedRule)
      )
        return false;

      // Serialize claims on the region config row, then recheck the same event
      // watermark with current notification switches. Later events stay pending.
      const [countRow] = await execute(
        `SELECT COUNT(DISTINCT e.country, e.variant_group_id) AS group_count
         FROM variant_group_split_events e
         INNER JOIN variant_groups vg
           ON vg.id = e.variant_group_id AND vg.country = e.country
         WHERE ${emergencyEventFilter(countries, true)}`,
        eventParams,
      );
      if (Number(countRow?.group_count || 0) <= currentRule.threshold)
        return false;

      await execute(
        `UPDATE variant_group_split_events e
         INNER JOIN variant_groups vg
           ON vg.id = e.variant_group_id AND vg.country = e.country
         SET e.phone_attempted_at = UTC_TIMESTAMP()
         WHERE ${emergencyEventFilter(countries, true)}`,
        eventParams,
      );
      await execute(
        `UPDATE feishu_config SET last_emergency_at = UTC_TIMESTAMP() WHERE country = ?`,
        [region],
      );
      return true;
    });
  }
}

module.exports = FeishuConfig;
