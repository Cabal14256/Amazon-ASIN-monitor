const { query } = require('../config/competitor-database');
const cacheService = require('../services/cacheService');
const logger = require('../utils/logger');

function extractParentAsinFromCheckResult(checkResult) {
  if (!checkResult) return null;
  let parsedResult = checkResult;
  if (typeof checkResult === 'string') {
    if (!checkResult.includes('parentAsin')) return null;
    try {
      parsedResult = JSON.parse(checkResult);
    } catch (error) {
      return null;
    }
  }

  const directParent =
    parsedResult.parentAsin || parsedResult.details?.parentAsin || null;
  if (directParent) {
    return String(directParent).trim().toUpperCase();
  }

  const resultParent = parsedResult.result?.details?.parentAsin || null;
  if (resultParent) {
    return String(resultParent).trim().toUpperCase();
  }

  return null;
}

class CompetitorMonitorHistory {
  // 查询监控历史列表
  static async findAll(params = {}) {
    const {
      variantGroupId = '',
      asinId = '',
      asin = '',
      country = '',
      checkType = '',
      isBroken = '',
      startTime = '',
      endTime = '',
      current = 1,
      pageSize = 10,
    } = params;

    let sql = `
      SELECT 
        mh.*,
        vg.name as variant_group_name,
        a.asin,
        a.name as asin_name,
        parent_asin.parent_asin
      FROM competitor_monitor_history mh
      LEFT JOIN competitor_variant_groups vg ON vg.id = mh.variant_group_id
      LEFT JOIN competitor_asins a ON a.id = mh.asin_id
      LEFT JOIN (
        SELECT
          variant_group_id,
          MAX(CASE WHEN asin_type IN ('1', 'MAIN_LINK') THEN asin END) AS parent_asin
        FROM competitor_asins
        GROUP BY variant_group_id
      ) parent_asin ON parent_asin.variant_group_id = mh.variant_group_id
      WHERE 1=1
    `;
    const conditions = [];

    if (variantGroupId) {
      sql += ` AND mh.variant_group_id = ?`;
      conditions.push(variantGroupId);
    }

    if (asinId) {
      sql += ` AND mh.asin_id = ?`;
      conditions.push(asinId);
    }

    if (asin) {
      sql += ` AND a.asin LIKE ?`;
      conditions.push(`%${asin}%`);
    }

    if (country) {
      sql += ` AND mh.country = ?`;
      conditions.push(country);
    }

    if (checkType) {
      sql += ` AND mh.check_type = ?`;
      conditions.push(checkType);
    }

    if (isBroken !== '') {
      sql += ` AND mh.is_broken = ?`;
      conditions.push(isBroken === '1' || isBroken === 1 ? 1 : 0);
    }

    if (startTime) {
      sql += ` AND mh.check_time >= ?`;
      conditions.push(startTime);
    }

    if (endTime) {
      sql += ` AND mh.check_time <= ?`;
      conditions.push(endTime);
    }

    const countKey = `competitorMonitorHistoryCount:${
      variantGroupId || 'ALL'
    }:${asinId || 'ALL'}:${asin || 'ALL'}:${country || 'ALL'}:${
      checkType || 'ALL'
    }:${isBroken || 'ALL'}:${startTime || 'ALL'}:${endTime || 'ALL'}`;
    let total = await cacheService.getAsync(countKey);
    if (total === null) {
      // 获取总数
      const countSql = sql.replace(
        /SELECT[\s\S]*?FROM/,
        'SELECT COUNT(*) as total FROM',
      );
      const countResult = await query(countSql, conditions);
      total = countResult[0]?.total || 0;
      await cacheService.setAsync(countKey, total, 60 * 1000);
    } else {
      logger.debug('CompetitorMonitorHistory.findAll 使用缓存总数:', countKey);
    }

    // 分页 - LIMIT 和 OFFSET 不能使用参数绑定，必须直接拼接（确保是整数）
    const offset = (Number(current) - 1) * Number(pageSize);
    const limit = Number(pageSize);
    sql += ` ORDER BY mh.check_time DESC LIMIT ${limit} OFFSET ${offset}`;

    const list = await query(sql, conditions);

    // 转换字段名：数据库下划线命名 -> 前端驼峰命名
    const formattedList = list.map((item) => {
      const parentAsinFromCheckResult = extractParentAsinFromCheckResult(
        item.check_result,
      );
      return {
        ...item,
        checkTime: item.check_time,
        checkType: item.check_type,
        isBroken: item.is_broken,
        notificationSent: item.notification_sent,
        variantGroupName: item.variant_group_name,
        asinName: item.asin_name,
        parentAsin: parentAsinFromCheckResult || item.parent_asin || null,
        createTime: item.create_time,
      };
    });

    return {
      list: formattedList,
      total,
      current: Number(current),
      pageSize: Number(pageSize),
    };
  }

  // 根据ID查询监控历史
  static async findById(id) {
    const [history] = await query(
      `SELECT 
        mh.*,
        vg.name as variant_group_name,
        a.asin,
        a.name as asin_name,
        parent_asin.parent_asin
      FROM competitor_monitor_history mh
      LEFT JOIN competitor_variant_groups vg ON vg.id = mh.variant_group_id
      LEFT JOIN competitor_asins a ON a.id = mh.asin_id
      LEFT JOIN (
        SELECT
          variant_group_id,
          MAX(CASE WHEN asin_type IN ('1', 'MAIN_LINK') THEN asin END) AS parent_asin
        FROM competitor_asins
        GROUP BY variant_group_id
      ) parent_asin ON parent_asin.variant_group_id = mh.variant_group_id
      WHERE mh.id = ?`,
      [id],
    );

    if (history) {
      // 转换字段名：数据库下划线命名 -> 前端驼峰命名
      const parentAsinFromCheckResult = extractParentAsinFromCheckResult(
        history.check_result,
      );
      return {
        ...history,
        checkTime: history.check_time,
        checkType: history.check_type,
        isBroken: history.is_broken,
        notificationSent: history.notification_sent,
        variantGroupName: history.variant_group_name,
        asinName: history.asin_name,
        parentAsin: parentAsinFromCheckResult || history.parent_asin || null,
        createTime: history.create_time,
      };
    }
    return history;
  }

  // 创建监控历史记录
  static async create(data) {
    const {
      variantGroupId,
      asinId,
      checkType = 'GROUP',
      country,
      isBroken = 0,
      checkResult = null,
      checkTime = new Date(),
      notificationSent = 0,
    } = data;

    const sql = `
      INSERT INTO competitor_monitor_history 
      (variant_group_id, asin_id, check_type, country, is_broken, check_result, check_time, notification_sent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const result = await query(sql, [
      variantGroupId || null,
      asinId || null,
      checkType,
      country,
      isBroken ? 1 : 0,
      checkResult ? JSON.stringify(checkResult) : null,
      checkTime,
      notificationSent ? 1 : 0,
    ]);

    return result.insertId;
  }

  // 批量创建监控历史记录
  static async bulkCreate(entries) {
    if (!entries || entries.length === 0) {
      return [];
    }

    const placeholders = [];
    const values = [];
    for (const entry of entries) {
      placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?)');
      values.push(
        entry.variantGroupId || null,
        entry.asinId || null,
        entry.checkType || 'GROUP',
        entry.country || null,
        entry.isBroken ? 1 : 0,
        entry.checkResult ? JSON.stringify(entry.checkResult) : null,
        entry.checkTime || new Date(),
        entry.notificationSent ? 1 : 0,
      );
    }

    const sql = `
      INSERT INTO competitor_monitor_history 
      (variant_group_id, asin_id, check_type, country, is_broken, check_result, check_time, notification_sent)
      VALUES ${placeholders.join(', ')}
    `;

    const result = await query(sql, values);
    return result;
  }

  // 更新通知状态
  static async updateNotificationStatus(country, checkTime, notificationSent) {
    const sql = `
      UPDATE competitor_monitor_history 
      SET notification_sent = ? 
      WHERE country = ? AND check_time = ? AND notification_sent = 0
    `;
    const result = await query(sql, [
      notificationSent ? 1 : 0,
      country,
      checkTime,
    ]);
    return result.affectedRows;
  }
}

module.exports = CompetitorMonitorHistory;
