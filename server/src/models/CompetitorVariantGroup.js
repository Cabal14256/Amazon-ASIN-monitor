const { query } = require('../config/competitor-database');
const { v4: uuidv4 } = require('uuid');
const cacheService = require('../services/cacheService');

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

class CompetitorVariantGroup {
  // 查询所有变体组（带分页和筛选）
  static async findAll(params = {}) {
    const {
      keyword = '',
      country = '',
      variantStatus = '',
      current = 1,
      pageSize = 10,
    } = params;

    const shouldUseCache =
      !keyword && Number(current) === 1 && Number(pageSize) <= 100;
    const cacheKey = `competitorVariantGroups:${country || 'ALL'}:${
      variantStatus || 'ALL'
    }:pageSize:${pageSize}`;
    if (shouldUseCache) {
      const cachedValue = cacheService.get(cacheKey);
      if (cachedValue) {
        console.log('CompetitorVariantGroup.findAll 使用缓存:', cacheKey);
        return JSON.parse(JSON.stringify(cachedValue));
      }
    }

    let sql = `
      SELECT DISTINCT
        vg.*,
        COUNT(DISTINCT a.id) as asin_count
      FROM competitor_variant_groups vg
      LEFT JOIN competitor_asins a ON a.variant_group_id = vg.id
      WHERE 1=1
    `;
    const queryValues = [];

    if (keyword) {
      // 搜索变体组名称、变体组ID，以及ASIN代码
      sql += ` AND (vg.name LIKE ? OR vg.id LIKE ? OR a.asin LIKE ?)`;
      queryValues.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    if (country) {
      sql += ` AND vg.country = ?`;
      queryValues.push(country);
    }

    if (variantStatus) {
      const isBroken = variantStatus === 'BROKEN' ? 1 : 0;
      sql += ` AND vg.is_broken = ?`;
      queryValues.push(isBroken);
    }

    sql += ` GROUP BY vg.id`;

    // 获取总数（需要关联ASIN表以支持ASIN搜索）
    let countSql = `SELECT COUNT(DISTINCT vg.id) as total FROM competitor_variant_groups vg LEFT JOIN competitor_asins a ON a.variant_group_id = vg.id WHERE 1=1`;
    const countValues = [];

    if (keyword) {
      // 搜索变体组名称、变体组ID，以及ASIN代码
      countSql += ` AND (vg.name LIKE ? OR vg.id LIKE ? OR a.asin LIKE ?)`;
      countValues.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    if (country) {
      countSql += ` AND vg.country = ?`;
      countValues.push(country);
    }
    if (variantStatus) {
      const isBroken = variantStatus === 'BROKEN' ? 1 : 0;
      countSql += ` AND vg.is_broken = ?`;
      countValues.push(isBroken);
    }

    const countResult = await query(countSql, countValues);
    const total = countResult[0]?.total || 0;

    // 分页 - LIMIT 和 OFFSET 不能使用参数绑定，必须直接拼接（确保是整数）
    const offset = (Number(current) - 1) * Number(pageSize);
    const limit = Number(pageSize);
    sql += ` ORDER BY vg.create_time DESC LIMIT ${limit} OFFSET ${offset}`;

    // 调试日志
    console.log('执行SQL:', sql);
    console.log('查询参数:', queryValues);

    const list = await query(sql, queryValues);
    console.log('查询到的竞品变体组数量:', list.length);

    // 优化：使用批量查询替代N+1查询
    // 一次性获取所有变体组的ASIN数据，然后在应用层分组
    if (list.length > 0) {
      const groupIds = list.map((group) => group.id);
      // 使用 IN 查询一次性获取所有ASIN
      const placeholders = groupIds.map(() => '?').join(',');
      const allAsins = await query(
        `SELECT 
          id, asin, name, asin_type, country, brand, variant_group_id, 
          is_broken, variant_status, create_time, update_time,
          last_check_time, feishu_notify_enabled
        FROM competitor_asins 
        WHERE variant_group_id IN (${placeholders})
        ORDER BY variant_group_id, create_time ASC`,
        groupIds,
      );

      // 按 variant_group_id 分组ASIN数据
      const asinsByGroupId = {};
      for (const asin of allAsins) {
        const groupId = asin.variant_group_id;
        if (!asinsByGroupId[groupId]) {
          asinsByGroupId[groupId] = [];
        }
        asinsByGroupId[groupId].push(asin);
      }

      // 为每个变体组分配ASIN数据
      for (const group of list) {
        const asins = asinsByGroupId[group.id] || [];
        console.log(`竞品变体组 ${group.id} 查询到的ASIN数量:`, asins.length);

        group.children = asins.map((asin) => ({
          id: asin.id,
          asin: asin.asin,
          name: asin.name,
          asinType: normalizeAsinType(asin.asin_type), // 转换为驼峰命名并标准化
          country: asin.country,
          brand: asin.brand,
          parentId: group.id,
          isBroken: asin.is_broken,
          variantStatus: asin.variant_status,
          createTime: asin.create_time,
          updateTime: asin.update_time,
          lastCheckTime: asin.last_check_time,
          feishuNotifyEnabled:
            asin.feishu_notify_enabled !== null
              ? asin.feishu_notify_enabled
              : 0, // 默认为0（竞品默认关闭）
        }));

        // 根据ASIN的变体状态动态计算变体组状态
        // 如果至少有一个ASIN的变体状态为异常，则整个变体组显示为异常
        const hasBrokenASIN = group.children.some(
          (child) => child.isBroken === 1,
        );
        if (hasBrokenASIN) {
          group.is_broken = 1;
          group.isBroken = 1;
          group.variant_status = 'BROKEN';
          group.variantStatus = 'BROKEN';
        } else {
          group.is_broken = 0;
          group.isBroken = 0;
          group.variant_status = 'NORMAL';
          group.variantStatus = 'NORMAL';
        }

        // 添加字段映射（驼峰命名）
        group.updateTime = group.update_time;
        group.createTime = group.create_time;
        group.lastCheckTime = group.last_check_time;
        group.feishuNotifyEnabled =
          group.feishu_notify_enabled !== null
            ? group.feishu_notify_enabled
            : 0; // 默认为0（竞品默认关闭）
      }
    }

    const result = {
      list,
      total,
      current: Number(current),
      pageSize: Number(pageSize),
    };

    if (shouldUseCache) {
      cacheService.set(cacheKey, JSON.parse(JSON.stringify(result)), 60 * 1000);
    }

    return result;
  }

  // 按批次查询变体组（用于分批处理）
  static async findByCountryBatch(country, batchIndex, totalBatches) {
    if (totalBatches <= 1) {
      // 如果只有一批，直接返回所有
      return this.findByCountryPage(country, 1, 10000);
    }

    // 使用变体组ID的哈希值来分配批次
    // 这样可以确保同一个变体组总是被分配到同一批次
    const sql = `
      SELECT
        id,
        name,
        country
      FROM competitor_variant_groups
      WHERE country = ?
      AND (CRC32(id) % ?) = ?
      ORDER BY create_time ASC
    `;
    const results = await query(sql, [country, totalBatches, batchIndex]);
    return results;
  }

  static async findByCountryPage(country, page = 1, pageSize = 200) {
    const offset = (Number(page) - 1) * Number(pageSize);
    const sql = `
      SELECT
        id,
        name,
        country
      FROM competitor_variant_groups
      WHERE country = ?
      ORDER BY create_time ASC
      LIMIT ${Number(pageSize)} OFFSET ${offset}
    `;
    return query(sql, [country]);
  }

  static clearCache() {
    cacheService.deleteByPrefix('competitorVariantGroups:');
  }

  // 根据ID查询变体组
  static async findById(id) {
    const [group] = await query(
      `SELECT * FROM competitor_variant_groups WHERE id = ?`,
      [id],
    );
    if (group) {
      const asins = await query(
        `SELECT
          id, asin, name, asin_type, country, brand, variant_group_id,
          is_broken, variant_status, create_time, update_time,
          last_check_time, feishu_notify_enabled
        FROM competitor_asins WHERE variant_group_id = ? ORDER BY create_time ASC`,
        [id],
      );
      group.children = asins.map((asin) => ({
        id: asin.id,
        asin: asin.asin,
        name: asin.name,
        asinType: normalizeAsinType(asin.asin_type),
        country: asin.country,
        brand: asin.brand,
        parentId: group.id,
        isBroken: asin.is_broken,
        variantStatus: asin.variant_status,
        createTime: asin.create_time,
        updateTime: asin.update_time,
        lastCheckTime: asin.last_check_time,
        feishuNotifyEnabled:
          asin.feishu_notify_enabled !== null ? asin.feishu_notify_enabled : 0, // 默认为0（竞品默认关闭）
      }));

      // 根据ASIN的变体状态动态计算变体组状态
      // 如果至少有一个ASIN的变体状态为异常，则整个变体组显示为异常
      const hasBrokenASIN = group.children.some(
        (child) => child.isBroken === 1,
      );
      if (hasBrokenASIN) {
        group.is_broken = 1;
        group.isBroken = 1;
        group.variant_status = 'BROKEN';
        group.variantStatus = 'BROKEN';
      } else {
        group.is_broken = 0;
        group.isBroken = 0;
        group.variant_status = 'NORMAL';
        group.variantStatus = 'NORMAL';
      }

      // 添加字段映射（驼峰命名）
      group.updateTime = group.update_time;
      group.createTime = group.create_time;
      group.lastCheckTime = group.last_check_time;
      group.feishuNotifyEnabled =
        group.feishu_notify_enabled !== null ? group.feishu_notify_enabled : 0; // 默认为0（竞品默认关闭）
    }
    return group;
  }

  // 创建变体组
  static async create(data) {
    const id = uuidv4();
    const { name, country, brand } = data;
    await query(
      `INSERT INTO competitor_variant_groups (id, name, country, brand, is_broken, variant_status, feishu_notify_enabled)
       VALUES (?, ?, ?, ?, 0, 'NORMAL', 0)`,
      [id, name, country, brand],
    );
    this.clearCache();
    return this.findById(id);
  }

  // 更新变体组
  static async update(id, data) {
    const { name, country, brand } = data;
    // 更新变体组信息时更新 update_time
    await query(
      `UPDATE competitor_variant_groups SET name = ?, country = ?, brand = ?, update_time = NOW() WHERE id = ?`,
      [name, country, brand, id],
    );
    this.clearCache();
    return this.findById(id);
  }

  // 删除变体组
  static async delete(id) {
    // 外键约束会自动删除关联的ASIN
    await query(`DELETE FROM competitor_variant_groups WHERE id = ?`, [id]);
    this.clearCache();
    return true;
  }

  // 更新变体状态
  static async updateVariantStatus(id, isBroken) {
    const variantStatus = isBroken ? 'BROKEN' : 'NORMAL';
    // 注意：更新变体状态时不更新 update_time，因为可以通过监控更新时间得知
    // 先保存当前的 update_time，然后更新字段，最后恢复 update_time，避免 ON UPDATE CURRENT_TIMESTAMP 触发
    const [group] = await query(
      `SELECT update_time FROM competitor_variant_groups WHERE id = ?`,
      [id],
    );
    const savedUpdateTime = group?.update_time;

    await query(
      `UPDATE competitor_variant_groups SET is_broken = ?, variant_status = ? WHERE id = ?`,
      [isBroken ? 1 : 0, variantStatus, id],
    );

    // 如果有保存的 update_time，恢复它
    if (savedUpdateTime) {
      await query(
        `UPDATE competitor_variant_groups SET update_time = ? WHERE id = ?`,
        [savedUpdateTime, id],
      );
    }

    this.clearCache();
    return this.findById(id);
  }

  // 更新监控时间
  static async updateLastCheckTime(id) {
    // 注意：更新监控时间时不更新 update_time，因为可以通过监控更新时间得知
    // 先保存当前的 update_time，然后更新字段，最后恢复 update_time，避免 ON UPDATE CURRENT_TIMESTAMP 触发
    const [group] = await query(
      `SELECT update_time FROM competitor_variant_groups WHERE id = ?`,
      [id],
    );
    const savedUpdateTime = group?.update_time;

    await query(
      `UPDATE competitor_variant_groups SET last_check_time = NOW() WHERE id = ?`,
      [id],
    );

    // 如果有保存的 update_time，恢复它
    if (savedUpdateTime) {
      await query(
        `UPDATE competitor_variant_groups SET update_time = ? WHERE id = ?`,
        [savedUpdateTime, id],
      );
    }

    this.clearCache();
    return this.findById(id);
  }

  // 更新飞书通知开关
  static async updateFeishuNotify(id, enabled) {
    // 更新飞书通知开关时更新 update_time
    await query(
      `UPDATE competitor_variant_groups SET feishu_notify_enabled = ?, update_time = NOW() WHERE id = ?`,
      [enabled ? 1 : 0, id],
    );
    this.clearCache();
    return this.findById(id);
  }

  // 更新变体组的更新时间（专门用于ASIN变动时调用）
  static async updateTimeOnASINChange(id) {
    await query(
      `UPDATE competitor_variant_groups SET update_time = NOW() WHERE id = ?`,
      [id],
    );
    this.clearCache();
  }
}

module.exports = CompetitorVariantGroup;
