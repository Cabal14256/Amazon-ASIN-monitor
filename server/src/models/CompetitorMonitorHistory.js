const { query } = require('../config/competitor-database');
const cacheService = require('../services/cacheService');
const logger = require('../utils/logger');

const COUNT_CACHE_PREFIX = 'competitorMonitorHistoryCount:';

function invalidateCountCache() {
  cacheService.deleteByPrefix(COUNT_CACHE_PREFIX);
  void cacheService.deleteByPrefixAsync(COUNT_CACHE_PREFIX);
}

function serializeCheckResult(checkResult) {
  if (checkResult === null || checkResult === undefined) {
    return null;
  }
  return typeof checkResult === 'string'
    ? checkResult
    : JSON.stringify(checkResult);
}

function formatDateToSqlText(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function extractParentAsinFromCheckResult(checkResult) {
  if (!checkResult) return null;

  let parsedResult = checkResult;
  for (
    let index = 0;
    index < 2 && typeof parsedResult === 'string';
    index += 1
  ) {
    if (!parsedResult.includes('parentAsin')) {
      return null;
    }
    try {
      parsedResult = JSON.parse(parsedResult);
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

    const countKey = `${COUNT_CACHE_PREFIX}${variantGroupId || 'ALL'}:${
      asinId || 'ALL'
    }:${asin || 'ALL'}:${country || 'ALL'}:${checkType || 'ALL'}:${
      isBroken || 'ALL'
    }:${startTime || 'ALL'}:${endTime || 'ALL'}`;
    let total = await cacheService.getAsync(countKey);
    if (total === null) {
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

    const offset = (Number(current) - 1) * Number(pageSize);
    const limit = Number(pageSize);
    sql += ` ORDER BY mh.check_time DESC, mh.id DESC LIMIT ${limit} OFFSET ${offset}`;

    const list = await query(sql, conditions);

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
      serializeCheckResult(checkResult),
      checkTime,
      notificationSent ? 1 : 0,
    ]);

    invalidateCountCache();
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
        serializeCheckResult(entry.checkResult),
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
    invalidateCountCache();
    return result;
  }

  static async updateNotificationStatusByRange(
    country,
    startTime,
    endTime,
    notificationSent = 1,
  ) {
    if (!country || !startTime || !endTime) {
      return 0;
    }

    const startDate =
      startTime instanceof Date ? startTime : new Date(startTime);
    const endDate = endTime instanceof Date ? endTime : new Date(endTime);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return 0;
    }

    const rangeStart = startDate <= endDate ? startDate : endDate;
    const rangeEnd = startDate <= endDate ? endDate : startDate;
    const normalizedRangeStart = new Date(rangeStart);
    const normalizedRangeEnd = new Date(rangeEnd);

    normalizedRangeStart.setMilliseconds(0);
    normalizedRangeEnd.setMilliseconds(0);

    const result = await query(
      `UPDATE competitor_monitor_history
       SET notification_sent = ?
       WHERE country = ?
         AND check_time >= ?
         AND check_time <= ?
         AND is_broken = 1
         AND notification_sent = 0`,
      [
        notificationSent ? 1 : 0,
        country,
        formatDateToSqlText(normalizedRangeStart),
        formatDateToSqlText(normalizedRangeEnd),
      ],
    );

    invalidateCountCache();
    return result.affectedRows || 0;
  }

  // 更新通知状态
  static async updateNotificationStatus(
    country,
    checkTime,
    notificationSent = 1,
  ) {
    const checkTimeDate =
      checkTime instanceof Date ? checkTime : new Date(checkTime);
    const timeStart = new Date(checkTimeDate.getTime() - 60 * 1000);
    const timeEnd = new Date(checkTimeDate.getTime() + 2 * 60 * 1000);

    return this.updateNotificationStatusByRange(
      country,
      timeStart,
      timeEnd,
      notificationSent,
    );
  }
}

module.exports = CompetitorMonitorHistory;
