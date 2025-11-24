const { query } = require('../config/database');

class SPAPIConfig {
  // 获取所有配置
  static async findAll() {
    const list = await query(
      `SELECT * FROM sp_api_config ORDER BY config_key ASC`,
    );
    return list;
  }

  // 根据键查询配置
  static async findByKey(configKey) {
    const [config] = await query(
      `SELECT * FROM sp_api_config WHERE config_key = ?`,
      [configKey],
    );
    return config;
  }

  // 创建或更新配置
  static async upsert(data) {
    const { configKey, configValue, description } = data;

    // 检查是否已存在
    const existing = await this.findByKey(configKey);

    if (existing) {
      // 更新
      await query(
        `UPDATE sp_api_config SET config_value = ?, description = ?, update_time = NOW() WHERE config_key = ?`,
        [configValue, description, configKey],
      );
    } else {
      // 创建
      await query(
        `INSERT INTO sp_api_config (config_key, config_value, description) VALUES (?, ?, ?)`,
        [configKey, configValue, description],
      );
    }

    return this.findByKey(configKey);
  }

  // 批量更新配置
  static async batchUpdate(configs) {
    const results = [];
    for (const config of configs) {
      const result = await this.upsert(config);
      results.push(result);
    }
    return results;
  }

  // 删除配置
  static async delete(configKey) {
    await query(`DELETE FROM sp_api_config WHERE config_key = ?`, [configKey]);
    return true;
  }

  // 获取所有配置为对象格式
  static async getAllAsObject() {
    const list = await this.findAll();
    const configObj = {};
    for (const item of list) {
      configObj[item.config_key] = item.config_value;
    }
    return configObj;
  }
}

module.exports = SPAPIConfig;
