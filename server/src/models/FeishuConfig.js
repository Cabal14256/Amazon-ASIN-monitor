const { pool } = require('../config/database');
const { normalizeEmergencyConfig } = require('../utils/feishuEmergencyConfig');
const logger = require('../utils/logger');

// 配置包含 webhook 与联系人，数据库错误不得输出带绑定参数的原始 SQL。
async function query(sql, params = []) {
  try {
    const [rows] = await pool.execute({ sql, timeout: 10000 }, params);
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

  static async countEmergencyASINs(region, startTimeSql, endTimeSql) {
    const countries = requireRegion(region);
    const [result] = await query(
      `SELECT COUNT(DISTINCT mh.country, COALESCE(NULLIF(mh.asin_code, ''), mh.asin_id)) AS broken_count
       FROM monitor_history mh
       INNER JOIN asins a ON a.id = mh.asin_id
       INNER JOIN variant_groups vg ON vg.id = a.variant_group_id
       WHERE mh.country IN (${countries.map(() => '?').join(', ')})
         AND mh.check_type = 'ASIN'
         AND mh.is_broken = 1
         AND mh.check_time >= ?
         AND mh.check_time <= ?
         AND COALESCE(a.feishu_notify_enabled, 1) <> 0
         AND COALESCE(vg.feishu_notify_enabled, 1) <> 0`,
      [...countries, startTimeSql, endTimeSql],
    );
    return Number(result?.broken_count) || 0;
  }

  static async claimEmergency(region, cooldownMinutes) {
    requireRegion(region);
    const { cooldownMinutes: validatedCooldown } = normalizeEmergencyConfig({
      cooldownMinutes,
    });
    const result = await query(
      `UPDATE feishu_config
       SET last_emergency_at = UTC_TIMESTAMP()
       WHERE country = ?
         AND enabled = 1
         AND JSON_EXTRACT(emergency_config, '$.enabled') = TRUE
         AND (last_emergency_at IS NULL
           OR last_emergency_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE))`,
      [region, validatedCooldown],
    );
    return result.affectedRows === 1;
  }
}

module.exports = FeishuConfig;
