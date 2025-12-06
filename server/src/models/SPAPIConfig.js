const { query, pool } = require('../config/database');

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

  // 批量更新配置（使用事务和批量SQL优化）
  static async batchUpdate(configs) {
    if (configs.length === 0) return [];

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // 使用批量INSERT ... ON DUPLICATE KEY UPDATE
      const values = configs.map((c) => [
        c.configKey,
        c.configValue || '',
        c.description || '',
      ]);

      const placeholders = values.map(() => '(?, ?, ?)').join(', ');
      const sql = `
        INSERT INTO sp_api_config (config_key, config_value, description)
        VALUES ${placeholders}
        ON DUPLICATE KEY UPDATE
          config_value = VALUES(config_value),
          description = VALUES(description),
          update_time = NOW()
      `;

      const flatValues = values.flat();
      await connection.query(sql, flatValues);

      await connection.commit();

      // 返回更新后的配置
      const results = [];
      for (const config of configs) {
        const result = await this.findByKey(config.configKey);
        if (result) {
          results.push(result);
        }
      }
      return results;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
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
