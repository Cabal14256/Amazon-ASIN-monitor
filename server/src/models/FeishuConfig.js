const { query } = require('../config/database');

class FeishuConfig {
  // 查询所有飞书配置（只返回US和EU）
  static async findAll() {
    const list = await query(
      `SELECT * FROM feishu_config WHERE country IN ('US', 'EU') ORDER BY country ASC`,
    );
    // 转换字段名为驼峰命名
    return list.map((item) => ({
      id: item.id,
      country: item.country,
      webhookUrl: item.webhook_url,
      enabled: item.enabled,
      createTime: item.create_time,
      updateTime: item.update_time,
    }));
  }

  // 根据国家查询配置（映射到区域）
  static async findByCountry(country) {
    // 国家到区域的映射
    const regionMap = {
      US: 'US',
      UK: 'EU',
      DE: 'EU',
      FR: 'EU',
      IT: 'EU',
      ES: 'EU',
    };
    const region = regionMap[country] || country;

    const [config] = await query(
      `SELECT * FROM feishu_config WHERE country = ? AND enabled = 1`,
      [region],
    );
    return config;
  }

  // 根据区域查询配置
  static async findByRegion(region) {
    const [config] = await query(
      `SELECT * FROM feishu_config WHERE country = ? AND enabled = 1`,
      [region],
    );
    return config;
  }

  // 创建或更新配置
  static async upsert(data) {
    const { country, webhookUrl, enabled = 1 } = data;

    // 检查是否已存在（不检查 enabled 状态）
    const [existing] = await query(
      `SELECT * FROM feishu_config WHERE country = ?`,
      [country],
    );

    if (existing) {
      // 更新
      await query(
        `UPDATE feishu_config SET webhook_url = ?, enabled = ?, update_time = NOW() WHERE country = ?`,
        [webhookUrl, enabled ? 1 : 0, country],
      );
    } else {
      // 创建
      await query(
        `INSERT INTO feishu_config (country, webhook_url, enabled) VALUES (?, ?, ?)`,
        [country, webhookUrl, enabled ? 1 : 0],
      );
    }

    // 返回更新后的配置（不检查 enabled 状态）
    const [updated] = await query(
      `SELECT * FROM feishu_config WHERE country = ?`,
      [country],
    );
    // 转换字段名为驼峰命名
    if (updated) {
      return {
        id: updated.id,
        country: updated.country,
        webhookUrl: updated.webhook_url,
        enabled: updated.enabled,
        createTime: updated.create_time,
        updateTime: updated.update_time,
      };
    }
    return null;
  }

  // 删除配置
  static async delete(country) {
    await query(`DELETE FROM feishu_config WHERE country = ?`, [country]);
    return true;
  }

  // 启用/禁用配置
  static async toggleEnabled(country, enabled) {
    await query(
      `UPDATE feishu_config SET enabled = ?, update_time = NOW() WHERE country = ?`,
      [enabled ? 1 : 0, country],
    );
    return this.findByCountry(country);
  }
}

module.exports = FeishuConfig;
