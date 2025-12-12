const { query } = require('../config/database');

class BackupConfig {
  // 获取备份配置（只返回第一条，因为只有一条配置）
  static async findOne() {
    const [config] = await query(
      `SELECT * FROM backup_config ORDER BY id ASC LIMIT 1`,
    );
    if (!config) {
      // 如果没有配置，返回默认配置
      return {
        id: null,
        enabled: false,
        scheduleType: 'daily',
        scheduleValue: null,
        backupTime: '02:00',
      };
    }
    // 转换字段名为驼峰命名
    return {
      id: config.id,
      enabled: config.enabled === 1,
      scheduleType: config.schedule_type,
      scheduleValue: config.schedule_value,
      backupTime: config.backup_time,
      createTime: config.create_time,
      updateTime: config.update_time,
    };
  }

  // 创建或更新配置
  static async upsert(data) {
    const {
      enabled = false,
      scheduleType = 'daily',
      scheduleValue = null,
      backupTime = '02:00',
    } = data;

    // 检查是否已存在
    const [existing] = await query(
      `SELECT * FROM backup_config ORDER BY id ASC LIMIT 1`,
    );

    if (existing) {
      // 更新
      await query(
        `UPDATE backup_config SET enabled = ?, schedule_type = ?, schedule_value = ?, backup_time = ?, update_time = NOW() WHERE id = ?`,
        [enabled ? 1 : 0, scheduleType, scheduleValue, backupTime, existing.id],
      );
    } else {
      // 创建
      await query(
        `INSERT INTO backup_config (enabled, schedule_type, schedule_value, backup_time) VALUES (?, ?, ?, ?)`,
        [enabled ? 1 : 0, scheduleType, scheduleValue, backupTime],
      );
    }

    // 返回更新后的配置
    return this.findOne();
  }
}

module.exports = BackupConfig;
