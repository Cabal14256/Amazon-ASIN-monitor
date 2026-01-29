const { query } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const cacheService = require('../services/cacheService');
const logger = require('../utils/logger');

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

class VariantGroup {
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
    const cacheKey = `variantGroups:${country || 'ALL'}:${
      variantStatus || 'ALL'
    }:pageSize:${pageSize}`;
    if (shouldUseCache) {
      const cachedValue = await cacheService.getAsync(cacheKey);
      if (cachedValue) {
        logger.info('VariantGroup.findAll 使用缓存:', cacheKey);
        return JSON.parse(JSON.stringify(cachedValue));
      }
    }

    let sql = `
      SELECT DISTINCT
        vg.*,
        COUNT(DISTINCT a.id) as asin_count
      FROM variant_groups vg
      LEFT JOIN asins a ON a.variant_group_id = vg.id
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
      // 使用子查询检查变体组是否有指定状态的ASIN
      // 对于"异常"：至少有一个ASIN的is_broken=1
      // 对于"正常"：所有ASIN的is_broken=0（或没有ASIN）
      if (isBroken === 1) {
        // 筛选异常：至少有一个异常的ASIN
        sql += ` AND EXISTS (
          SELECT 1 FROM asins a2 
          WHERE a2.variant_group_id = vg.id 
          AND a2.is_broken = 1
        )`;
      } else {
        // 筛选正常：没有异常的ASIN（所有ASIN都是正常的，或者没有ASIN）
        sql += ` AND NOT EXISTS (
          SELECT 1 FROM asins a2 
          WHERE a2.variant_group_id = vg.id 
          AND a2.is_broken = 1
        )`;
      }
    }

    sql += ` GROUP BY vg.id`;

    // 优化 COUNT 查询：当没有 keyword 时，避免不必要的 LEFT JOIN
    let countSql = `SELECT COUNT(DISTINCT vg.id) as total FROM variant_groups vg WHERE 1=1`;
    const countValues = [];

    if (keyword) {
      // 有keyword时需要搜索变体组名称、ID或ASIN，使用 EXISTS 子查询替代 JOIN 以提高性能
      countSql = `SELECT COUNT(DISTINCT vg.id) as total 
        FROM variant_groups vg 
        WHERE EXISTS (
          SELECT 1 FROM asins a 
          WHERE a.variant_group_id = vg.id 
          AND (vg.name LIKE ? OR vg.id LIKE ? OR a.asin LIKE ?)
        )`;
      countValues.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);

      // 添加 country 条件
      if (country) {
        countSql += ` AND vg.country = ?`;
        countValues.push(country);
      }

      // 添加 variantStatus 条件
      if (variantStatus) {
        const isBroken = variantStatus === 'BROKEN' ? 1 : 0;
        if (isBroken === 1) {
          countSql += ` AND EXISTS (
            SELECT 1 FROM asins a2 
            WHERE a2.variant_group_id = vg.id 
            AND a2.is_broken = 1
          )`;
        } else {
          countSql += ` AND NOT EXISTS (
            SELECT 1 FROM asins a2 
            WHERE a2.variant_group_id = vg.id 
            AND a2.is_broken = 1
          )`;
        }
      }
    } else {
      // 没有 keyword 时，只需要在 variant_groups 表上查询，避免 JOIN
      if (country) {
        countSql += ` AND vg.country = ?`;
        countValues.push(country);
      }
      if (variantStatus) {
        const isBroken = variantStatus === 'BROKEN' ? 1 : 0;
        if (isBroken === 1) {
          countSql += ` AND EXISTS (
            SELECT 1 FROM asins a2 
            WHERE a2.variant_group_id = vg.id 
            AND a2.is_broken = 1
          )`;
        } else {
          countSql += ` AND NOT EXISTS (
            SELECT 1 FROM asins a2 
            WHERE a2.variant_group_id = vg.id 
            AND a2.is_broken = 1
          )`;
        }
      }
    }

    const countResult = await query(countSql, countValues);
    const total = countResult[0]?.total || 0;

    // 获取ASIN总数（不受分页和筛选影响，但受keyword、country、variantStatus筛选影响）
    let totalASINsSql = `SELECT COUNT(*) as total FROM asins a WHERE 1=1`;
    const totalASINsValues = [];

    if (keyword) {
      // 如果有关键词搜索，需要关联变体组表
      totalASINsSql = `SELECT COUNT(DISTINCT a.id) as total 
                        FROM asins a 
                        LEFT JOIN variant_groups vg ON vg.id = a.variant_group_id 
                        WHERE 1=1 
                        AND (vg.name LIKE ? OR vg.id LIKE ? OR a.asin LIKE ?)`;
      totalASINsValues.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    if (country) {
      totalASINsSql += ` AND a.country = ?`;
      totalASINsValues.push(country);
    }

    if (variantStatus) {
      const isBroken = variantStatus === 'BROKEN' ? 1 : 0;
      totalASINsSql += ` AND a.is_broken = ?`;
      totalASINsValues.push(isBroken);
    }

    const totalASINsResult = await query(totalASINsSql, totalASINsValues);
    const totalASINs = totalASINsResult[0]?.total || 0;

    // 分页 - LIMIT 和 OFFSET 不能使用参数绑定，必须直接拼接（确保是整数）
    const offset = (Number(current) - 1) * Number(pageSize);
    const limit = Number(pageSize);
    sql += ` ORDER BY vg.create_time DESC LIMIT ${limit} OFFSET ${offset}`;

    // 调试日志
    logger.debug('执行SQL:', sql);
    logger.debug('查询参数:', queryValues);

    const list = await query(sql, queryValues);
    logger.debug('查询到的变体组数量:', list.length);

    // 优化：使用批量查询替代N+1查询
    // 一次性获取所有变体组的ASIN数据，然后在应用层分组
    if (list.length > 0) {
      const groupIds = list.map((group) => group.id);
      // 使用 IN 查询一次性获取所有ASIN
      const placeholders = groupIds.map(() => '?').join(',');
      const allAsins = await query(
        `SELECT 
          id, asin, name, asin_type, country, site, brand, variant_group_id, 
          is_broken, variant_status, create_time, update_time,
          last_check_time, feishu_notify_enabled
        FROM asins 
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
        logger.debug(`变体组 ${group.id} 查询到的ASIN数量:`, asins.length);

        group.children = asins.map((asin) => ({
          id: asin.id,
          asin: asin.asin,
          name: asin.name,
          asinType: normalizeAsinType(asin.asin_type), // 转换为驼峰命名并标准化
          country: asin.country,
          site: asin.site,
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
              : 1, // 默认为1
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
            : 1;
      }
    }

    const result = {
      list,
      total,
      totalASINs,
      current: Number(current),
      pageSize: Number(pageSize),
    };

    if (shouldUseCache) {
      await cacheService.setAsync(
        cacheKey,
        JSON.parse(JSON.stringify(result)),
        60 * 1000,
      );
    }

    return result;
  }

  /**
   * 分页按国家查询变体组（仅基础字段）
   * @param {string} country
   * @param {number} page
   * @param {number} pageSize
   */
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
      FROM variant_groups
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
      FROM variant_groups
      WHERE country = ?
      ORDER BY create_time ASC
      LIMIT ${Number(pageSize)} OFFSET ${offset}
    `;
    return query(sql, [country]);
  }

  static clearCache() {
    cacheService.deleteByPrefix('variantGroups:');
    void cacheService.deleteByPrefixAsync('variantGroups:');
  }

  // 根据ID查询变体组
  static async findById(id) {
    const [group] = await query(`SELECT * FROM variant_groups WHERE id = ?`, [
      id,
    ]);
    if (group) {
      const asins = await query(
        `SELECT 
          id, asin, name, asin_type, country, site, brand, variant_group_id, 
          is_broken, variant_status, create_time, update_time,
          last_check_time, feishu_notify_enabled
        FROM asins WHERE variant_group_id = ? ORDER BY create_time ASC`,
        [id],
      );
      group.children = asins.map((asin) => ({
        id: asin.id,
        asin: asin.asin,
        name: asin.name,
        asinType: asin.asin_type,
        country: asin.country,
        site: asin.site,
        brand: asin.brand,
        parentId: group.id,
        isBroken: asin.is_broken,
        variantStatus: asin.variant_status,
        createTime: asin.create_time,
        updateTime: asin.update_time,
        lastCheckTime: asin.last_check_time,
        feishuNotifyEnabled:
          asin.feishu_notify_enabled !== null ? asin.feishu_notify_enabled : 1,
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
        group.feishu_notify_enabled !== null ? group.feishu_notify_enabled : 1;
    }
    return group;
  }

  // 批量查询变体组（附带ASIN列表）
  static async findByIdsWithChildren(ids = []) {
    if (!Array.isArray(ids) || ids.length === 0) {
      return new Map();
    }

    const uniqueIds = Array.from(
      new Set(ids.map((item) => item || '').filter(Boolean)),
    );
    if (uniqueIds.length === 0) {
      return new Map();
    }

    const placeholders = uniqueIds.map(() => '?').join(',');
    const groups = await query(
      `SELECT * FROM variant_groups WHERE id IN (${placeholders})`,
      uniqueIds,
    );

    if (!groups || groups.length === 0) {
      return new Map();
    }

    const asins = await query(
      `SELECT
        id, asin, name, asin_type, country, site, brand, variant_group_id,
        is_broken, variant_status, create_time, update_time,
        last_check_time, feishu_notify_enabled
      FROM asins WHERE variant_group_id IN (${placeholders})
      ORDER BY variant_group_id, create_time ASC`,
      uniqueIds,
    );

    const asinsByGroupId = {};
    for (const asin of asins) {
      const groupId = asin.variant_group_id;
      if (!asinsByGroupId[groupId]) {
        asinsByGroupId[groupId] = [];
      }
      asinsByGroupId[groupId].push(asin);
    }

    const groupMap = new Map();
    for (const group of groups) {
      const groupAsins = asinsByGroupId[group.id] || [];
      group.children = groupAsins.map((asin) => ({
        id: asin.id,
        asin: asin.asin,
        name: asin.name,
        asinType: normalizeAsinType(asin.asin_type),
        country: asin.country,
        site: asin.site,
        brand: asin.brand,
        parentId: group.id,
        isBroken: asin.is_broken,
        variantStatus: asin.variant_status,
        createTime: asin.create_time,
        updateTime: asin.update_time,
        lastCheckTime: asin.last_check_time,
        feishuNotifyEnabled:
          asin.feishu_notify_enabled !== null ? asin.feishu_notify_enabled : 1,
      }));

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

      group.updateTime = group.update_time;
      group.createTime = group.create_time;
      group.lastCheckTime = group.last_check_time;
      group.feishuNotifyEnabled =
        group.feishu_notify_enabled !== null ? group.feishu_notify_enabled : 1;

      groupMap.set(group.id, group);
    }

    return groupMap;
  }

  // 创建变体组
  static async create(data) {
    const id = uuidv4();
    const { name, country, site, brand } = data;
    await query(
      `INSERT INTO variant_groups (id, name, country, site, brand, is_broken, variant_status) 
       VALUES (?, ?, ?, ?, ?, 0, 'NORMAL')`,
      [id, name, country, site, brand],
    );
    this.clearCache();
    return this.findById(id);
  }

  // 更新变体组
  static async update(id, data) {
    const { name, country, site, brand } = data;
    // 更新变体组信息时更新 update_time
    await query(
      `UPDATE variant_groups SET name = ?, country = ?, site = ?, brand = ?, update_time = NOW() WHERE id = ?`,
      [name, country, site, brand, id],
    );
    this.clearCache();
    return this.findById(id);
  }

  // 删除变体组
  static async delete(id) {
    // 外键约束会自动删除关联的ASIN
    await query(`DELETE FROM variant_groups WHERE id = ?`, [id]);
    this.clearCache();
    return true;
  }

  // 更新变体状态
  static async updateVariantStatus(id, isBroken) {
    const variantStatus = isBroken ? 'BROKEN' : 'NORMAL';
    // 注意：更新变体状态时不更新 update_time，因为可以通过监控更新时间得知
    // 显式赋值 update_time，避免 ON UPDATE CURRENT_TIMESTAMP 触发
    await query(
      `UPDATE variant_groups
       SET is_broken = ?, variant_status = ?, update_time = update_time
       WHERE id = ?`,
      [isBroken ? 1 : 0, variantStatus, id],
    );

    this.clearCache();
  }

  // 更新监控时间
  static async updateLastCheckTime(id) {
    // 注意：更新监控时间时不更新 update_time，因为可以通过监控更新时间得知
    // 显式赋值 update_time，避免 ON UPDATE CURRENT_TIMESTAMP 触发
    await query(
      `UPDATE variant_groups
       SET last_check_time = NOW(), update_time = update_time
       WHERE id = ?`,
      [id],
    );

    this.clearCache();
  }

  // 同时更新变体状态与监控时间（减少写入次数）
  static async updateVariantStatusAndCheckTime(id, isBroken) {
    const variantStatus = isBroken ? 'BROKEN' : 'NORMAL';
    await query(
      `UPDATE variant_groups
       SET is_broken = ?, variant_status = ?, last_check_time = NOW(), update_time = update_time
       WHERE id = ?`,
      [isBroken ? 1 : 0, variantStatus, id],
    );

    this.clearCache();
  }

  // 更新飞书通知开关
  static async updateFeishuNotify(id, enabled) {
    // 更新飞书通知开关时更新 update_time
    await query(
      `UPDATE variant_groups SET feishu_notify_enabled = ?, update_time = NOW() WHERE id = ?`,
      [enabled ? 1 : 0, id],
    );
    this.clearCache();
    return this.findById(id);
  }

  // 更新变体组的更新时间（专门用于ASIN变动时调用）
  static async updateTimeOnASINChange(id) {
    await query(`UPDATE variant_groups SET update_time = NOW() WHERE id = ?`, [
      id,
    ]);
    this.clearCache();
  }
}

module.exports = VariantGroup;
