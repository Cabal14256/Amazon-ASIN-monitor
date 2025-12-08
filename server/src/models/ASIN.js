const { query } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const VariantGroup = require('./VariantGroup');

// 转换ASIN类型：将旧格式(MAIN_LINK/SUB_REVIEW)转换为新格式(1/2)
function normalizeAsinType(asinType) {
  if (!asinType) return null;
  const type = String(asinType).trim();
  // 兼容旧格式
  if (type === 'MAIN_LINK') return '1';
  if (type === 'SUB_REVIEW') return '2';
  // 新格式直接返回
  if (type === '1' || type === 1) return '1';
  if (type === '2' || type === 2) return '2';
  return null;
}

class ASIN {
  // 查询所有ASIN
  static async findAll(params = {}) {
    const { variantGroupId, country, current = 1, pageSize = 10 } = params;
    let sql = `SELECT * FROM asins WHERE 1=1`;
    const conditions = [];

    if (variantGroupId) {
      sql += ` AND variant_group_id = ?`;
      conditions.push(variantGroupId);
    }

    if (country) {
      sql += ` AND country = ?`;
      conditions.push(country);
    }

    // 分页 - LIMIT 和 OFFSET 不能使用参数绑定，必须直接拼接（确保是整数）
    const offset = (Number(current) - 1) * Number(pageSize);
    const limit = Number(pageSize);
    sql += ` ORDER BY create_time DESC LIMIT ${limit} OFFSET ${offset}`;

    const list = await query(sql, conditions);
    return list;
  }

  // 根据ID查询ASIN
  static async findById(id) {
    const [asin] = await query(
      `SELECT 
        id, asin, name, asin_type, country, site, brand, variant_group_id, 
        is_broken, variant_status, create_time, update_time,
        last_check_time, feishu_notify_enabled
      FROM asins WHERE id = ?`,
      [id],
    );
    if (asin) {
      return {
        id: asin.id,
        asin: asin.asin,
        name: asin.name,
        asinType: normalizeAsinType(asin.asin_type), // 转换为驼峰命名并标准化
        country: asin.country,
        site: asin.site,
        brand: asin.brand,
        variantGroupId: asin.variant_group_id,
        isBroken: asin.is_broken,
        variantStatus: asin.variant_status,
        createTime: asin.create_time,
        updateTime: asin.update_time,
        lastCheckTime: asin.last_check_time,
        feishuNotifyEnabled:
          asin.feishu_notify_enabled !== null ? asin.feishu_notify_enabled : 1,
      };
    }
    return null;
  }

  // 更新飞书通知开关
  static async updateFeishuNotify(asinId, enabled) {
    await query(
      `UPDATE asins SET feishu_notify_enabled = ?, update_time = NOW() WHERE id = ?`,
      [enabled ? 1 : 0, asinId],
    );
    return this.findById(asinId);
  }

  // 更新监控时间
  static async updateLastCheckTime(asinId) {
    await query(
      `UPDATE asins SET last_check_time = NOW(), update_time = NOW() WHERE id = ?`,
      [asinId],
    );
    return this.findById(asinId);
  }

  // 根据ASIN编码查询（可选：同时查询国家）
  static async findByASIN(asin, country = null) {
    if (country) {
      const [result] = await query(
        `SELECT * FROM asins WHERE asin = ? AND country = ?`,
        [asin, country],
      );
      return result;
    }
    const [result] = await query(`SELECT * FROM asins WHERE asin = ?`, [asin]);
    return result;
  }

  // 创建ASIN
  static async create(data) {
    const id = uuidv4();
    const { asin, name, country, site, brand, variantGroupId, asinType } = data;

    // 检查ASIN是否已存在（同一国家）
    const existing = await this.findByASIN(asin, country);
    if (existing) {
      throw new Error(`ASIN ${asin} 在国家 ${country} 中已存在`);
    }

    await query(
      `INSERT INTO asins (id, asin, name, asin_type, country, site, brand, variant_group_id, is_broken, variant_status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'NORMAL')`,
      [
        id,
        asin,
        name || null,
        asinType || null,
        country,
        site,
        brand,
        variantGroupId,
      ],
    );

    // 更新变体组的更新时间（ASIN变动）
    if (variantGroupId) {
      await VariantGroup.updateTimeOnASINChange(variantGroupId);
    }

    return this.findById(id);
  }

  // 更新ASIN
  static async update(id, data) {
    const { asin, name, country, site, brand, asinType } = data;
    await query(
      `UPDATE asins SET asin = ?, name = ?, asin_type = ?, country = ?, site = ?, brand = ?, update_time = NOW() WHERE id = ?`,
      [asin, name, asinType || null, country, site, brand, id],
    );
    return this.findById(id);
  }

  // 移动到其他变体组
  static async moveToGroup(asinId, targetGroupId) {
    // 先获取当前ASIN的变体组ID（源变体组）
    const asin = await this.findById(asinId);
    if (!asin) {
      throw new Error('ASIN不存在');
    }
    const sourceGroupId = asin.variantGroupId;

    await query(
      `UPDATE asins SET variant_group_id = ?, update_time = NOW() WHERE id = ?`,
      [targetGroupId, asinId],
    );

    // 更新源变体组和目标变体组的更新时间（ASIN变动）
    if (sourceGroupId) {
      await VariantGroup.updateTimeOnASINChange(sourceGroupId);
    }
    if (targetGroupId && targetGroupId !== sourceGroupId) {
      await VariantGroup.updateTimeOnASINChange(targetGroupId);
    }

    return this.findById(asinId);
  }

  // 删除ASIN
  static async delete(id) {
    // 先获取ASIN的变体组ID，以便更新变体组的更新时间
    const asin = await this.findById(id);
    const variantGroupId = asin?.variantGroupId;

    await query(`DELETE FROM asins WHERE id = ?`, [id]);

    // 更新变体组的更新时间（ASIN变动）
    if (variantGroupId) {
      await VariantGroup.updateTimeOnASINChange(variantGroupId);
    }

    return true;
  }

  // 更新变体状态
  static async updateVariantStatus(id, isBroken) {
    const variantStatus = isBroken ? 'BROKEN' : 'NORMAL';
    await query(
      `UPDATE asins SET is_broken = ?, variant_status = ?, update_time = NOW() WHERE id = ?`,
      [isBroken ? 1 : 0, variantStatus, id],
    );
    return this.findById(id);
  }
}

module.exports = ASIN;
