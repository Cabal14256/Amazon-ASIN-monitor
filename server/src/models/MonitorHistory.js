const { query } = require('../config/database');
const cacheService = require('../services/cacheService');
const analyticsCacheService = require('../services/analyticsCacheService');
const logger = require('../utils/logger');

const AGG_COVERAGE_CACHE = new Map();

function alignTimeToSlotText(value, granularity) {
  if (!value) {
    return '';
  }
  const normalized = String(value).trim().replace('T', ' ');
  const datePart = normalized.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return '';
  }
  if (granularity === 'day') {
    return `${datePart} 00:00:00`;
  }
  const hourPart = normalized.length >= 13 ? normalized.slice(11, 13) : '00';
  if (!/^\d{2}$/.test(hourPart)) {
    return '';
  }
  return `${datePart} ${hourPart}:00:00`;
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

class MonitorHistory {
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
        mh.id,
        mh.variant_group_id,
        mh.asin_id,
        mh.check_type,
        mh.country,
        mh.is_broken,
        mh.check_time,
        mh.check_result,
        mh.notification_sent,
        mh.create_time,
        COALESCE(mh.variant_group_name, vg.name) as variant_group_name,
        COALESCE(mh.asin_code, a.asin) as asin,
        COALESCE(mh.asin_name, a.name) as asin_name,
        a.asin_type as asin_type
      FROM monitor_history mh
      LEFT JOIN variant_groups vg ON vg.id = mh.variant_group_id
      LEFT JOIN asins a ON a.id = mh.asin_id
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
      // 支持多ASIN查询：如果asin是数组，使用IN查询；否则使用LIKE查询（向后兼容）
      if (Array.isArray(asin) && asin.length > 0) {
        const placeholders = asin.map(() => '?').join(',');
        sql += ` AND (COALESCE(mh.asin_code, a.asin) IN (${placeholders}))`;
        conditions.push(...asin);
      } else if (typeof asin === 'string') {
        // 优先在快照字段中搜索，如果没有则搜索关联表
        sql += ` AND (COALESCE(mh.asin_code, a.asin) LIKE ?)`;
        conditions.push(`%${asin}%`);
      }
    }

    if (country) {
      if (country === 'EU') {
        // EU汇总：包含所有欧洲国家
        sql += ` AND mh.country IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
      } else {
        sql += ` AND mh.country = ?`;
        conditions.push(country);
      }
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

    const countKey = `monitorHistoryCount:${variantGroupId || 'ALL'}:${
      asinId || 'ALL'
    }:${asin || 'ALL'}:${country || 'ALL'}:${checkType || 'ALL'}:${
      isBroken || 'ALL'
    }:${startTime || 'ALL'}:${endTime || 'ALL'}`;
    let total = await cacheService.getAsync(countKey);
    if (total === null) {
      // 优化：COUNT查询直接查询monitor_history表，避免LEFT JOIN
      // 构建独立的COUNT查询，只使用monitor_history表的字段
      let countSql = `SELECT COUNT(*) as total FROM monitor_history mh WHERE 1=1`;
      const countConditions = [];

      if (variantGroupId) {
        countSql += ` AND mh.variant_group_id = ?`;
        countConditions.push(variantGroupId);
      }

      if (asinId) {
        countSql += ` AND mh.asin_id = ?`;
        countConditions.push(asinId);
      }

      if (asin) {
        // 支持多ASIN查询：如果asin是数组，使用IN查询；否则使用LIKE查询（向后兼容）
        if (Array.isArray(asin) && asin.length > 0) {
          const placeholders = asin.map(() => '?').join(',');
          countSql += ` AND mh.asin_code IN (${placeholders})`;
          countConditions.push(...asin);
        } else if (typeof asin === 'string') {
          // 只搜索快照字段，避免JOIN
          countSql += ` AND mh.asin_code LIKE ?`;
          countConditions.push(`%${asin}%`);
        }
      }

      if (country) {
        if (country === 'EU') {
          countSql += ` AND mh.country IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
        } else {
          countSql += ` AND mh.country = ?`;
          countConditions.push(country);
        }
      }

      if (checkType) {
        countSql += ` AND mh.check_type = ?`;
        countConditions.push(checkType);
      }

      if (isBroken !== '') {
        countSql += ` AND mh.is_broken = ?`;
        countConditions.push(isBroken === '1' || isBroken === 1 ? 1 : 0);
      }

      if (startTime) {
        countSql += ` AND mh.check_time >= ?`;
        countConditions.push(startTime);
      }

      if (endTime) {
        countSql += ` AND mh.check_time <= ?`;
        countConditions.push(endTime);
      }

      const countResult = await query(countSql, countConditions);
      total = countResult[0]?.total || 0;
      await cacheService.setAsync(countKey, total, 60 * 1000);
    } else {
      logger.info('MonitorHistory.findAll 使用缓存总数:', countKey);
    }

    // 分页 - LIMIT 和 OFFSET 不能使用参数绑定，必须直接拼接（确保是整数）
    const offset = (Number(current) - 1) * Number(pageSize);
    const limit = Number(pageSize);
    sql += ` ORDER BY mh.check_time DESC LIMIT ${limit} OFFSET ${offset}`;

    const list = await query(sql, conditions);

    // 转换字段名：数据库下划线命名 -> 前端驼峰命名
    const formattedList = list.map((item) => ({
      ...item,
      checkTime: item.check_time,
      checkType: item.check_type,
      isBroken: item.is_broken,
      notificationSent: item.notification_sent,
      variantGroupName: item.variant_group_name,
      asinName: item.asin_name,
      asinType: item.asin_type,
      createTime: item.create_time,
    }));

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
        mh.id,
        mh.variant_group_id,
        mh.asin_id,
        mh.check_type,
        mh.country,
        mh.is_broken,
        mh.check_time,
        mh.check_result,
        mh.notification_sent,
        mh.create_time,
        COALESCE(mh.variant_group_name, vg.name) as variant_group_name,
        COALESCE(mh.asin_code, a.asin) as asin,
        COALESCE(mh.asin_name, a.name) as asin_name,
        a.asin_type as asin_type
      FROM monitor_history mh
      LEFT JOIN variant_groups vg ON vg.id = mh.variant_group_id
      LEFT JOIN asins a ON a.id = mh.asin_id
      WHERE mh.id = ?`,
      [id],
    );

    if (history) {
      // 转换字段名：数据库下划线命名 -> 前端驼峰命名
      return {
        ...history,
        checkTime: history.check_time,
        checkType: history.check_type,
        isBroken: history.is_broken,
        notificationSent: history.notification_sent,
        variantGroupName: history.variant_group_name,
        asinName: history.asin_name,
        asinType: history.asin_type,
        createTime: history.create_time,
      };
    }
    return history;
  }

  // 创建监控历史记录
  static async create(data) {
    const {
      variantGroupId,
      variantGroupName,
      asinId,
      asinCode,
      asinName,
      siteSnapshot,
      brandSnapshot,
      checkType,
      country,
      isBroken,
      checkTime,
      checkResult,
    } = data;

    const result = await query(
      `INSERT INTO monitor_history 
       (variant_group_id, variant_group_name, asin_id, asin_code, asin_name, site_snapshot, brand_snapshot, check_type, country, is_broken, check_time, check_result) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        variantGroupId || null,
        variantGroupName || null,
        asinId || null,
        asinCode || null,
        asinName || null,
        siteSnapshot || null,
        brandSnapshot || null,
        checkType || 'GROUP',
        country,
        isBroken ? 1 : 0,
        checkTime || new Date(),
        checkResult ? JSON.stringify(checkResult) : null,
      ],
    );

    cacheService.deleteByPrefix('monitorHistoryCount:');
    void cacheService.deleteByPrefixAsync('monitorHistoryCount:');
    analyticsCacheService.deleteByPrefix('periodSummary:');
    return this.findById(result.insertId);
  }

  static async bulkCreate(entries = []) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return;
    }

    const placeholders = [];
    const values = [];
    for (const entry of entries) {
      placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      values.push(
        entry.variantGroupId || null,
        entry.variantGroupName || null,
        entry.asinId || null,
        entry.asinCode || null,
        entry.asinName || null,
        entry.siteSnapshot || null,
        entry.brandSnapshot || null,
        entry.checkType || 'GROUP',
        entry.country || null,
        entry.isBroken ? 1 : 0,
        entry.checkTime || new Date(),
        entry.checkResult ? JSON.stringify(entry.checkResult) : null,
      );
    }

    const sql = `INSERT INTO monitor_history 
      (variant_group_id, variant_group_name, asin_id, asin_code, asin_name, site_snapshot, brand_snapshot, check_type, country, is_broken, check_time, check_result) 
      VALUES ${placeholders.join(', ')}`;

    await query(sql, values);
    cacheService.deleteByPrefix('monitorHistoryCount:');
    void cacheService.deleteByPrefixAsync('monitorHistoryCount:');
    // 清除统计查询缓存
    analyticsCacheService.deleteByPrefix('statisticsByTime:');
    analyticsCacheService.deleteByPrefix('allCountriesSummary:');
    analyticsCacheService.deleteByPrefix('regionSummary:');
    analyticsCacheService.deleteByPrefix('periodSummary:');
  }

  // 获取统计信息
  static async getStatistics(params = {}) {
    const {
      variantGroupId = '',
      asinId = '',
      country = '',
      startTime = '',
      endTime = '',
    } = params;

    let sql = `
      SELECT 
        COUNT(*) as total_checks,
        SUM(CASE WHEN is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
        SUM(CASE WHEN is_broken = 0 THEN 1 ELSE 0 END) as normal_count,
        COUNT(DISTINCT variant_group_id) as group_count,
        COUNT(DISTINCT asin_id) as asin_count
      FROM monitor_history
      WHERE 1=1
    `;
    const conditions = [];

    if (variantGroupId) {
      sql += ` AND variant_group_id = ?`;
      conditions.push(variantGroupId);
    }

    if (asinId) {
      sql += ` AND asin_id = ?`;
      conditions.push(asinId);
    }

    if (country) {
      if (country === 'EU') {
        // EU汇总：包含所有欧洲国家
        sql += ` AND country IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
      } else {
        sql += ` AND country = ?`;
        conditions.push(country);
      }
    }

    if (startTime) {
      sql += ` AND check_time >= ?`;
      conditions.push(startTime);
    }

    if (endTime) {
      sql += ` AND check_time <= ?`;
      conditions.push(endTime);
    }

    const [result] = await query(sql, conditions);
    // 将数据库字段名转换为前端期望的 camelCase 格式
    return {
      totalChecks: result?.total_checks || 0,
      brokenCount: result?.broken_count || 0,
      normalCount: result?.normal_count || 0,
      groupCount: result?.group_count || 0,
      asinCount: result?.asin_count || 0,
    };
  }

  static getStatisticsByTimeGroupConfig(groupBy = 'day') {
    if (groupBy === 'hour') {
      return {
        rawPeriodExpr: 'DATE_FORMAT(check_time, "%Y-%m-%d %H:00:00")',
        aggPeriodExpr: "DATE_FORMAT(agg.time_slot, '%Y-%m-%d %H:00:00')",
        aggGranularity: 'hour',
        slotWhereFormat: '%Y-%m-%d %H:00:00',
      };
    }
    if (groupBy === 'week') {
      return {
        rawPeriodExpr: 'DATE_FORMAT(check_time, "%Y-%u")',
        aggPeriodExpr: "DATE_FORMAT(agg.time_slot, '%Y-%u')",
        aggGranularity: 'day',
        slotWhereFormat: '%Y-%m-%d 00:00:00',
      };
    }
    if (groupBy === 'month') {
      return {
        rawPeriodExpr: 'DATE_FORMAT(check_time, "%Y-%m")',
        aggPeriodExpr: "DATE_FORMAT(agg.time_slot, '%Y-%m')",
        aggGranularity: 'day',
        slotWhereFormat: '%Y-%m-%d 00:00:00',
      };
    }
    return {
      rawPeriodExpr: 'DATE_FORMAT(check_time, "%Y-%m-%d")',
      aggPeriodExpr: "DATE_FORMAT(agg.time_slot, '%Y-%m-%d')",
      aggGranularity: 'day',
      slotWhereFormat: '%Y-%m-%d 00:00:00',
    };
  }

  static async getStatisticsByTimeFromRaw(params = {}) {
    const {
      country = '',
      startTime = '',
      endTime = '',
      groupBy = 'day',
    } = params;
    const config = MonitorHistory.getStatisticsByTimeGroupConfig(groupBy);

    // 构建WHERE条件和参数
    let whereClause = 'WHERE 1=1';
    const conditions = [];

    if (country) {
      if (country === 'EU') {
        // EU汇总：包含所有欧洲国家
        whereClause += ` AND country IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
      } else {
        whereClause += ` AND country = ?`;
        conditions.push(country);
      }
    }

    if (startTime) {
      whereClause += ` AND check_time >= ?`;
      conditions.push(startTime);
    }

    if (endTime) {
      whereClause += ` AND check_time <= ?`;
      conditions.push(endTime);
    }

    // 由于多个子查询都需要相同的参数，需要将参数数组重复多次
    const allConditions = [...conditions, ...conditions, ...conditions];

    // ratio_all_asin: 异常快照数 / 总快照数 × 100%（快照口径）
    // ratio_all_time: 按 (国家 + ASIN + 时间槽) 去重后，异常ASIN数 / 总ASIN数 × 100%（去重口径）
    const sql = `
      SELECT 
        t.time_period,
        t.total_checks,
        t.broken_count,
        t.normal_count,
        CASE 
          WHEN t.total_checks > 0 
          THEN (t.broken_count / t.total_checks) * 100
          ELSE 0 
        END as ratio_all_asin,
        COALESCE(dedup_stats.total_asins, 0) as total_asins_dedup,
        COALESCE(dedup_stats.broken_asins, 0) as broken_asins_dedup,
        CASE 
          WHEN COALESCE(dedup_stats.total_asins, 0) > 0 
          THEN (COALESCE(dedup_stats.broken_asins, 0) / COALESCE(dedup_stats.total_asins, 1)) * 100
          ELSE 0 
        END as ratio_all_time,
        COALESCE(asin_stats.total_asins, 0) as total_asins,
        COALESCE(asin_stats.broken_asins, 0) as broken_asins,
        CASE 
          WHEN COALESCE(asin_stats.total_asins, 0) > 0 
          THEN (COALESCE(asin_stats.broken_asins, 0) / COALESCE(asin_stats.total_asins, 1)) * 100
          ELSE 0 
        END as asin_broken_rate
      FROM (
        SELECT 
          ${config.rawPeriodExpr} as time_period,
          COUNT(*) as total_checks,
          SUM(CASE WHEN is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
          SUM(CASE WHEN is_broken = 0 THEN 1 ELSE 0 END) as normal_count
        FROM monitor_history
        ${whereClause}
        GROUP BY ${config.rawPeriodExpr}
      ) t
      LEFT JOIN (
        SELECT 
          time_period,
          COUNT(*) as total_asins,
          SUM(CASE WHEN has_broken > 0 THEN 1 ELSE 0 END) as broken_asins
        FROM (
          SELECT 
            ${config.rawPeriodExpr} as time_period,
            country,
            COALESCE(asin_id, asin_code) as asin_key,
            MAX(CASE WHEN is_broken = 1 THEN 1 ELSE 0 END) as has_broken
          FROM monitor_history
          ${whereClause}
          AND (asin_id IS NOT NULL OR asin_code IS NOT NULL)
          GROUP BY ${config.rawPeriodExpr}, country, COALESCE(asin_id, asin_code)
        ) dedup_grouped
        GROUP BY time_period
      ) dedup_stats ON t.time_period = dedup_stats.time_period
      LEFT JOIN (
        SELECT 
          ${config.rawPeriodExpr} as time_period,
          COUNT(DISTINCT COALESCE(asin_id, asin_code)) as total_asins,
          COUNT(
            DISTINCT CASE 
              WHEN is_broken = 1 THEN COALESCE(asin_id, asin_code) 
            END
          ) as broken_asins
        FROM monitor_history
        ${whereClause}
        AND (asin_id IS NOT NULL OR asin_code IS NOT NULL)
        GROUP BY ${config.rawPeriodExpr}
      ) asin_stats ON t.time_period = asin_stats.time_period
      ORDER BY t.time_period ASC
    `;

    return await query(sql, allConditions);
  }

  static async getStatisticsByTimeFromAgg(params = {}) {
    const {
      country = '',
      startTime = '',
      endTime = '',
      groupBy = 'day',
    } = params;
    const config = MonitorHistory.getStatisticsByTimeGroupConfig(groupBy);

    let whereClause = 'WHERE agg.granularity = ?';
    const conditions = [config.aggGranularity];

    if (country) {
      if (country === 'EU') {
        whereClause += ` AND agg.country IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
      } else {
        whereClause += ` AND agg.country = ?`;
        conditions.push(country);
      }
    }

    if (startTime) {
      whereClause += ` AND agg.time_slot >= DATE_FORMAT(?, '${config.slotWhereFormat}')`;
      conditions.push(startTime);
    }

    if (endTime) {
      whereClause += ` AND agg.time_slot <= DATE_FORMAT(?, '${config.slotWhereFormat}')`;
      conditions.push(endTime);
    }

    // hour/day粒度直接使用单层聚合，避免多层子查询导致的大量扫描
    if (groupBy === 'hour' || groupBy === 'day') {
      const fastSql = `
        SELECT
          ${config.aggPeriodExpr} as time_period,
          SUM(agg.check_count) as total_checks,
          SUM(agg.broken_count) as broken_count,
          SUM(agg.check_count) - SUM(agg.broken_count) as normal_count,
          CASE
            WHEN SUM(agg.check_count) > 0
            THEN (SUM(agg.broken_count) / SUM(agg.check_count)) * 100
            ELSE 0
          END as ratio_all_asin,
          COUNT(*) as total_asins_dedup,
          SUM(agg.has_broken) as broken_asins_dedup,
          CASE
            WHEN COUNT(*) > 0
            THEN (SUM(agg.has_broken) / COUNT(*)) * 100
            ELSE 0
          END as ratio_all_time,
          COUNT(DISTINCT agg.asin_key) as total_asins,
          COUNT(DISTINCT CASE WHEN agg.has_broken = 1 THEN agg.asin_key END) as broken_asins,
          CASE
            WHEN COUNT(DISTINCT agg.asin_key) > 0
            THEN (
              COUNT(DISTINCT CASE WHEN agg.has_broken = 1 THEN agg.asin_key END)
              / COUNT(DISTINCT agg.asin_key)
            ) * 100
            ELSE 0
          END as asin_broken_rate
        FROM monitor_history_agg agg
        ${whereClause}
        GROUP BY ${config.aggPeriodExpr}
        ORDER BY time_period ASC
      `;
      return await query(fastSql, conditions);
    }

    const allConditions = [...conditions, ...conditions, ...conditions];

    const sql = `
      SELECT
        t.time_period,
        t.total_checks,
        t.broken_count,
        (t.total_checks - t.broken_count) as normal_count,
        CASE 
          WHEN t.total_checks > 0 
          THEN (t.broken_count / t.total_checks) * 100
          ELSE 0 
        END as ratio_all_asin,
        COALESCE(dedup_stats.total_asins_dedup, 0) as total_asins_dedup,
        COALESCE(dedup_stats.broken_asins_dedup, 0) as broken_asins_dedup,
        CASE
          WHEN COALESCE(dedup_stats.total_asins_dedup, 0) > 0
          THEN (
            COALESCE(dedup_stats.broken_asins_dedup, 0)
            / COALESCE(dedup_stats.total_asins_dedup, 1)
          ) * 100
          ELSE 0
        END as ratio_all_time,
        COALESCE(asin_stats.total_asins, 0) as total_asins,
        COALESCE(asin_stats.broken_asins, 0) as broken_asins,
        CASE
          WHEN COALESCE(asin_stats.total_asins, 0) > 0
          THEN (
            COALESCE(asin_stats.broken_asins, 0)
            / COALESCE(asin_stats.total_asins, 1)
          ) * 100
          ELSE 0
        END as asin_broken_rate
      FROM (
        SELECT
          ${config.aggPeriodExpr} as time_period,
          SUM(agg.check_count) as total_checks,
          SUM(agg.broken_count) as broken_count
        FROM monitor_history_agg agg
        ${whereClause}
        GROUP BY ${config.aggPeriodExpr}
      ) t
      LEFT JOIN (
        SELECT
          time_period,
          COUNT(*) as total_asins_dedup,
          SUM(CASE WHEN has_broken > 0 THEN 1 ELSE 0 END) as broken_asins_dedup
        FROM (
          SELECT
            ${config.aggPeriodExpr} as time_period,
            agg.country,
            agg.asin_key,
            MAX(agg.has_broken) as has_broken
          FROM monitor_history_agg agg
          ${whereClause}
          GROUP BY ${config.aggPeriodExpr}, agg.country, agg.asin_key
        ) dedup_grouped
        GROUP BY time_period
      ) dedup_stats ON t.time_period = dedup_stats.time_period
      LEFT JOIN (
        SELECT
          ${config.aggPeriodExpr} as time_period,
          COUNT(DISTINCT agg.asin_key) as total_asins,
          COUNT(
            DISTINCT CASE
              WHEN agg.has_broken = 1 THEN agg.asin_key
            END
          ) as broken_asins
        FROM monitor_history_agg agg
        ${whereClause}
        GROUP BY ${config.aggPeriodExpr}
      ) asin_stats ON t.time_period = asin_stats.time_period
      ORDER BY t.time_period ASC
    `;

    return await query(sql, allConditions);
  }

  // 按时间分组统计
  static async getStatisticsByTime(params = {}) {
    const {
      country = '',
      startTime = '',
      endTime = '',
      groupBy = 'day',
    } = params;

    const cacheKey = `statisticsByTime:${country}:${startTime}:${endTime}:${groupBy}`;
    const ttlMs =
      Number(process.env.ANALYTICS_STATISTICS_BY_TIME_TTL_MS) || 300000;
    const cached = await analyticsCacheService.get(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const config = MonitorHistory.getStatisticsByTimeGroupConfig(groupBy);
    let list = null;
    const useAgg =
      process.env.ANALYTICS_AGG_ENABLED !== '0' &&
      MonitorHistory.canUseAggForRange(
        config.aggGranularity,
        startTime,
        endTime,
      );

    if (useAgg) {
      try {
        const isCovered = await MonitorHistory.isAggTableCoveringRange(
          'monitor_history_agg',
          config.aggGranularity,
          startTime,
          endTime,
        );
        if (!isCovered) {
          logger.info(
            '[统计查询] getStatisticsByTime 聚合表覆盖不足，回退原始表',
          );
        } else {
          list = await MonitorHistory.getStatisticsByTimeFromAgg(params);
          if (Array.isArray(list) && list.length === 0) {
            const hasRaw = await MonitorHistory.hasHistoryInRange(
              startTime,
              endTime,
            );
            if (hasRaw) {
              list = null;
            }
          } else {
            logger.info('[统计查询] getStatisticsByTime 使用聚合表');
          }
        }
      } catch (error) {
        logger.warn(
          '[统计查询] getStatisticsByTime 聚合表读取失败，回退原始表',
          error?.message || error,
        );
        list = null;
      }
    }

    if (list === null) {
      list = await MonitorHistory.getStatisticsByTimeFromRaw(params);
    }

    await analyticsCacheService.set(cacheKey, list, ttlMs);
    return list;
  }

  // 按国家分组统计
  static async getStatisticsByCountry(params = {}) {
    const { startTime = '', endTime = '' } = params;

    let sql = `
      SELECT 
        country,
        COUNT(*) as total_checks,
        SUM(CASE WHEN is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
        SUM(CASE WHEN is_broken = 0 THEN 1 ELSE 0 END) as normal_count
      FROM monitor_history
      WHERE 1=1
    `;
    const conditions = [];

    if (startTime) {
      sql += ` AND check_time >= ?`;
      conditions.push(startTime);
    }

    if (endTime) {
      sql += ` AND check_time <= ?`;
      conditions.push(endTime);
    }

    sql += ` GROUP BY country ORDER BY country ASC`;

    const list = await query(sql, conditions);
    return list;
  }

  // 高峰期统计
  static async getPeakHoursStatistics(params = {}) {
    const { country = '', startTime = '', endTime = '' } = params;

    if (!country) {
      throw new Error('高峰期统计需要指定国家');
    }

    const { isPeakHour } = require('../utils/peakHours');

    let sql = `
      SELECT 
        check_time,
        is_broken
      FROM monitor_history
      WHERE ${
        country === 'EU'
          ? "country IN ('UK', 'DE', 'FR', 'IT', 'ES')"
          : 'country = ?'
      }
    `;
    const conditions = country === 'EU' ? [] : [country];

    if (startTime) {
      sql += ` AND check_time >= ?`;
      conditions.push(startTime);
    }

    if (endTime) {
      sql += ` AND check_time <= ?`;
      conditions.push(endTime);
    }

    sql += ` ORDER BY check_time ASC`;

    const list = await query(sql, conditions);

    let peakBroken = 0;
    let peakTotal = 0;
    let offPeakBroken = 0;
    let offPeakTotal = 0;

    list.forEach((item) => {
      const checkTime = new Date(item.check_time);
      const isBroken = item.is_broken === 1;

      if (isPeakHour(checkTime, country)) {
        peakTotal++;
        if (isBroken) {
          peakBroken++;
        }
      } else {
        offPeakTotal++;
        if (isBroken) {
          offPeakBroken++;
        }
      }
    });

    return {
      peakBroken,
      peakTotal,
      peakRate: peakTotal > 0 ? (peakBroken / peakTotal) * 100 : 0,
      offPeakBroken,
      offPeakTotal,
      offPeakRate: offPeakTotal > 0 ? (offPeakBroken / offPeakTotal) * 100 : 0,
    };
  }

  // 按变体组分组统计
  static async getStatisticsByVariantGroup(params = {}) {
    const { country = '', startTime = '', endTime = '', limit = 10 } = params;

    let sql = `
      SELECT 
        mh.variant_group_id,
        vg.name as variant_group_name,
        COUNT(*) as total_checks,
        SUM(CASE WHEN mh.is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
        SUM(CASE WHEN mh.is_broken = 0 THEN 1 ELSE 0 END) as normal_count
      FROM monitor_history mh
      LEFT JOIN variant_groups vg ON vg.id = mh.variant_group_id
      WHERE mh.variant_group_id IS NOT NULL
    `;
    const conditions = [];

    if (country) {
      if (country === 'EU') {
        // EU汇总：包含所有欧洲国家
        sql += ` AND mh.country IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
      } else {
        sql += ` AND mh.country = ?`;
        conditions.push(country);
      }
    }

    if (startTime) {
      sql += ` AND mh.check_time >= ?`;
      conditions.push(startTime);
    }

    if (endTime) {
      sql += ` AND mh.check_time <= ?`;
      conditions.push(endTime);
    }

    sql += ` GROUP BY mh.variant_group_id, vg.name ORDER BY broken_count DESC, total_checks DESC LIMIT ${Number(
      limit,
    )}`;

    const list = await query(sql, conditions);
    return list;
  }

  // 快速判断某时间范围是否存在原始监控数据（聚合表为空时用于回退）
  static async hasHistoryInRange(startTime = '', endTime = '') {
    let sql = 'SELECT 1 FROM monitor_history WHERE 1=1';
    const conditions = [];

    if (startTime) {
      sql += ' AND check_time >= ?';
      conditions.push(startTime);
    }

    if (endTime) {
      sql += ' AND check_time <= ?';
      conditions.push(endTime);
    }

    sql += ' LIMIT 1';
    const result = await query(sql, conditions);
    return Array.isArray(result) && result.length > 0;
  }

  static canUseAggForRange(timeSlotGranularity, startTime, endTime = '') {
    const enforceLookback = process.env.ANALYTICS_AGG_ENFORCE_LOOKBACK === '1';
    if (!enforceLookback) {
      // 默认优先使用聚合表；如果聚合表无覆盖，再按业务逻辑回退原始表
      return true;
    }

    const baseTime = startTime || endTime;
    if (!baseTime) {
      return false;
    }
    const parsed = new Date(String(baseTime).replace(' ', 'T'));
    if (!Number.isFinite(parsed.getTime())) {
      return false;
    }

    const now = new Date();
    const diffMs = now.getTime() - parsed.getTime();
    const backfillHours =
      Number(process.env.ANALYTICS_AGG_BACKFILL_HOURS) || 48;
    const backfillDays = Number(process.env.ANALYTICS_AGG_BACKFILL_DAYS) || 30;
    const limitMs =
      timeSlotGranularity === 'hour'
        ? backfillHours * 60 * 60 * 1000
        : backfillDays * 24 * 60 * 60 * 1000;

    return diffMs <= limitMs;
  }

  // 从聚合表读取预聚合数据（用于加速统计查询）
  static async getAggGroupedRecords(params = {}) {
    const {
      startTime = '',
      endTime = '',
      timeSlotGranularity = 'day',
      countries = [],
    } = params;

    const slotSelectFormat =
      timeSlotGranularity === 'hour' ? '%Y-%m-%d %H:00:00' : '%Y-%m-%d';
    const slotWhereFormat =
      timeSlotGranularity === 'hour'
        ? '%Y-%m-%d %H:00:00'
        : '%Y-%m-%d 00:00:00';

    let whereClause = 'WHERE granularity = ?';
    const conditions = [timeSlotGranularity];

    if (startTime) {
      whereClause += ` AND time_slot >= DATE_FORMAT(?, '${slotWhereFormat}')`;
      conditions.push(startTime);
    }

    if (endTime) {
      whereClause += ` AND time_slot <= DATE_FORMAT(?, '${slotWhereFormat}')`;
      conditions.push(endTime);
    }

    if (Array.isArray(countries) && countries.length > 0) {
      const placeholders = countries.map(() => '?').join(',');
      whereClause += ` AND country IN (${placeholders})`;
      conditions.push(...countries);
    }

    const sql = `
      SELECT 
        DATE_FORMAT(time_slot, '${slotSelectFormat}') as time_slot,
        country,
        asin_key,
        check_count,
        broken_count,
        has_broken,
        has_peak,
        first_check_time
      FROM monitor_history_agg
      ${whereClause}
      ORDER BY first_check_time ASC
    `;

    return await query(sql, conditions);
  }

  static async getAggRangeCoverage(tableName, granularity) {
    const allowedTables = new Set([
      'monitor_history_agg',
      'monitor_history_agg_dim',
    ]);
    if (!allowedTables.has(tableName)) {
      throw new Error(`不支持的聚合表: ${tableName}`);
    }

    const cacheTtlMs =
      Number(process.env.ANALYTICS_AGG_COVERAGE_CACHE_TTL_MS) || 60000;
    const cacheKey = `${tableName}:${granularity}`;
    const now = Date.now();
    const cached = AGG_COVERAGE_CACHE.get(cacheKey);
    if (cached && now - cached.cachedAt < cacheTtlMs) {
      return cached;
    }

    const sql = `
      SELECT
        DATE_FORMAT(MIN(time_slot), '%Y-%m-%d %H:%i:%s') as min_slot,
        DATE_FORMAT(MAX(time_slot), '%Y-%m-%d %H:%i:%s') as max_slot
      FROM ${tableName}
      WHERE granularity = ?
    `;
    const [row] = await query(sql, [granularity]);
    const coverage = {
      minSlot: row?.min_slot || '',
      maxSlot: row?.max_slot || '',
      cachedAt: now,
    };
    AGG_COVERAGE_CACHE.set(cacheKey, coverage);
    return coverage;
  }

  static async isAggTableCoveringRange(
    tableName,
    granularity,
    startTime = '',
    endTime = '',
  ) {
    const coverage = await MonitorHistory.getAggRangeCoverage(
      tableName,
      granularity,
    );
    if (!coverage.minSlot || !coverage.maxSlot) {
      return false;
    }

    const alignedStart = alignTimeToSlotText(startTime, granularity);
    const alignedEnd = alignTimeToSlotText(endTime, granularity);
    let alignedEndForCheck = alignedEnd;
    if (alignedEnd) {
      // 当查询endTime落在未来（例如当天23:59:59）时，按当前时间槽做覆盖判断，避免误判回退
      const nowAligned = alignTimeToSlotText(
        formatDateToSqlText(new Date()),
        granularity,
      );
      if (nowAligned && alignedEndForCheck > nowAligned) {
        alignedEndForCheck = nowAligned;
      }
    }

    if (alignedStart && coverage.minSlot > alignedStart) {
      return false;
    }
    if (alignedEndForCheck && coverage.maxSlot < alignedEndForCheck) {
      // 允许聚合刷新存在小幅滞后，避免因为最后1~2小时未刷新而整体回退原始表
      const lagToleranceMs =
        (Number(process.env.ANALYTICS_AGG_ACCEPTABLE_LAG_MINUTES) || 120) *
        60 *
        1000;
      const maxSlotTime = new Date(
        coverage.maxSlot.replace(' ', 'T'),
      ).getTime();
      const endSlotTime = new Date(
        alignedEndForCheck.replace(' ', 'T'),
      ).getTime();
      if (
        !Number.isFinite(maxSlotTime) ||
        !Number.isFinite(endSlotTime) ||
        endSlotTime - maxSlotTime > lagToleranceMs
      ) {
        return false;
      }
    }
    return true;
  }

  static buildSummaryMetrics(row = {}) {
    const totalChecks = Number(row.total_checks) || 0;
    const brokenCount = Number(row.broken_count) || 0;
    const peakBroken = Number(row.peak_broken) || 0;
    const peakTotal = Number(row.peak_total) || 0;
    const lowBroken = Number(row.low_broken) || 0;
    const lowTotal = Number(row.low_total) || 0;
    const totalAsinsDedup = Number(row.total_asins_dedup) || 0;
    const brokenAsinsDedup = Number(row.broken_asins_dedup) || 0;

    const ratioAllAsin =
      totalChecks > 0 ? (brokenCount / totalChecks) * 100 : 0;
    const ratioAllTime =
      totalAsinsDedup > 0 ? (brokenAsinsDedup / totalAsinsDedup) * 100 : 0;
    const globalPeakRate =
      totalChecks > 0 ? (peakBroken / totalChecks) * 100 : 0;
    const globalLowRate = totalChecks > 0 ? (lowBroken / totalChecks) * 100 : 0;
    const ratioHigh = peakTotal > 0 ? (peakBroken / peakTotal) * 100 : 0;
    const ratioLow = lowTotal > 0 ? (lowBroken / lowTotal) * 100 : 0;

    return {
      totalChecks,
      ratioAllAsin,
      ratioAllTime,
      globalPeakRate,
      globalLowRate,
      ratioHigh,
      ratioLow,
      brokenCount,
      totalAsinsDedup,
      brokenAsinsDedup,
      peakBroken,
      peakTotal,
      lowBroken,
      lowTotal,
    };
  }

  static getPeakHourCase(countryField, timeField = 'mh.check_time') {
    const hourExpr = `HOUR(DATE_ADD(${timeField}, INTERVAL 8 HOUR))`;
    return `CASE 
      WHEN ${countryField} = 'US' THEN 
        (${hourExpr} >= 2 AND ${hourExpr} < 6)
        OR (${hourExpr} >= 9 AND ${hourExpr} < 12)
      WHEN ${countryField} = 'UK' THEN
        ${hourExpr} >= 22
        OR (${hourExpr} >= 0 AND ${hourExpr} < 2)
        OR (${hourExpr} >= 3 AND ${hourExpr} < 6)
      WHEN ${countryField} IN ('DE', 'FR', 'ES', 'IT') THEN
        ${hourExpr} >= 20
        OR (${hourExpr} >= 2 AND ${hourExpr} < 5)
      ELSE 0
    END`;
  }

  static async getAllCountriesSummaryFromAgg(params = {}) {
    const {
      startTime = '',
      endTime = '',
      timeSlotGranularity = 'day',
    } = params;

    const slotWhereFormat =
      timeSlotGranularity === 'hour'
        ? '%Y-%m-%d %H:00:00'
        : '%Y-%m-%d 00:00:00';

    let whereClause = 'WHERE granularity = ?';
    const conditions = [timeSlotGranularity];

    if (startTime) {
      whereClause += ` AND time_slot >= DATE_FORMAT(?, '${slotWhereFormat}')`;
      conditions.push(startTime);
    }

    if (endTime) {
      whereClause += ` AND time_slot <= DATE_FORMAT(?, '${slotWhereFormat}')`;
      conditions.push(endTime);
    }

    const sql = `
      SELECT
        SUM(check_count) as total_checks,
        SUM(broken_count) as broken_count,
        SUM(CASE WHEN has_peak = 1 THEN check_count ELSE 0 END) as peak_total,
        SUM(CASE WHEN has_peak = 1 THEN broken_count ELSE 0 END) as peak_broken,
        SUM(CASE WHEN has_peak = 0 THEN check_count ELSE 0 END) as low_total,
        SUM(CASE WHEN has_peak = 0 THEN broken_count ELSE 0 END) as low_broken,
        COUNT(*) as total_asins_dedup,
        SUM(CASE WHEN has_broken = 1 THEN 1 ELSE 0 END) as broken_asins_dedup
      FROM monitor_history_agg
      ${whereClause}
    `;

    const [row] = await query(sql, conditions);
    return row || {};
  }

  static async getAllCountriesSummaryFromRaw(params = {}) {
    const {
      startTime = '',
      endTime = '',
      timeSlotGranularity = 'day',
    } = params;

    const slotExpr =
      timeSlotGranularity === 'hour' ? 'mh.hour_ts' : 'mh.day_ts';
    const isPeakCase = MonitorHistory.getPeakHourCase(
      'mh.country',
      'mh.check_time',
    );

    let whereClause = 'WHERE 1=1';
    const conditions = [];

    if (startTime) {
      whereClause += ` AND mh.check_time >= ?`;
      conditions.push(startTime);
    }

    if (endTime) {
      whereClause += ` AND mh.check_time <= ?`;
      conditions.push(endTime);
    }

    const sql = `
      SELECT
        SUM(sub.check_count) as total_checks,
        SUM(sub.broken_count) as broken_count,
        SUM(CASE WHEN sub.has_peak = 1 THEN sub.check_count ELSE 0 END) as peak_total,
        SUM(CASE WHEN sub.has_peak = 1 THEN sub.broken_count ELSE 0 END) as peak_broken,
        SUM(CASE WHEN sub.has_peak = 0 THEN sub.check_count ELSE 0 END) as low_total,
        SUM(CASE WHEN sub.has_peak = 0 THEN sub.broken_count ELSE 0 END) as low_broken,
        COUNT(*) as total_asins_dedup,
        SUM(CASE WHEN sub.has_broken = 1 THEN 1 ELSE 0 END) as broken_asins_dedup
      FROM (
        SELECT
          ${slotExpr} as slot_raw,
          mh.country,
          COALESCE(mh.asin_id, mh.asin_code) as asin_key,
          COUNT(*) as check_count,
          SUM(CASE WHEN mh.is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
          MAX(mh.is_broken) as has_broken,
          MAX(${isPeakCase}) as has_peak
        FROM monitor_history mh
        ${whereClause}
        AND (mh.asin_id IS NOT NULL OR mh.asin_code IS NOT NULL)
        GROUP BY ${slotExpr}, mh.country, COALESCE(mh.asin_id, mh.asin_code)
      ) sub
    `;

    const [row] = await query(sql, conditions);
    return row || {};
  }

  // 全部国家汇总统计
  static async getAllCountriesSummary(params = {}) {
    const {
      startTime = '',
      endTime = '',
      timeSlotGranularity = 'day',
    } = params;

    // 生成缓存键
    const cacheKey = `allCountriesSummary:${startTime}:${endTime}:${timeSlotGranularity}`;
    const cached = await analyticsCacheService.get(cacheKey);
    if (cached !== null) {
      return cached;
    }

    let summaryRow = null;
    const useAgg =
      process.env.ANALYTICS_AGG_ENABLED !== '0' &&
      MonitorHistory.canUseAggForRange(timeSlotGranularity, startTime, endTime);
    if (useAgg) {
      try {
        const isCovered = await MonitorHistory.isAggTableCoveringRange(
          'monitor_history_agg',
          timeSlotGranularity,
          startTime,
          endTime,
        );
        if (!isCovered) {
          logger.info(
            '[统计查询] getAllCountriesSummary 聚合表覆盖不足，回退原始表',
          );
        } else {
          const aggRow = await MonitorHistory.getAllCountriesSummaryFromAgg({
            startTime,
            endTime,
            timeSlotGranularity,
          });

          if ((Number(aggRow.total_asins_dedup) || 0) === 0) {
            const hasRaw = await MonitorHistory.hasHistoryInRange(
              startTime,
              endTime,
            );
            if (hasRaw) {
              summaryRow = null;
            } else {
              summaryRow = aggRow;
            }
          } else {
            summaryRow = aggRow;
            logger.info('[统计查询] getAllCountriesSummary 使用聚合表');
          }
        }
      } catch (error) {
        logger.warn(
          '[统计查询] getAllCountriesSummary 聚合表读取失败，回退原始表',
          error?.message || error,
        );
        summaryRow = null;
      }
    }

    if (!summaryRow) {
      summaryRow = await MonitorHistory.getAllCountriesSummaryFromRaw({
        startTime,
        endTime,
        timeSlotGranularity,
      });
    }

    const metrics = MonitorHistory.buildSummaryMetrics(summaryRow);

    const result = {
      timeRange: startTime && endTime ? `${startTime} ~ ${endTime}` : '',
      ...metrics,
    };

    // 缓存结果5分钟
    await analyticsCacheService.set(cacheKey, result, 5 * 60 * 1000);
    return result;
  }

  // 区域汇总统计（美国/欧洲）
  static async getRegionSummary(params = {}) {
    const {
      startTime = '',
      endTime = '',
      timeSlotGranularity = 'day',
    } = params;

    // 生成缓存键
    const cacheKey = `regionSummary:${startTime}:${endTime}:${timeSlotGranularity}`;
    const cached = await analyticsCacheService.get(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const buildRegionResult = (regionCode, row) => {
      const metrics = MonitorHistory.buildSummaryMetrics(row);
      return {
        region: regionCode === 'US' ? '美国' : '欧洲',
        regionCode,
        timeRange: startTime && endTime ? `${startTime} ~ ${endTime}` : '',
        ...metrics,
      };
    };

    const getRegionSummaryFromAgg = async () => {
      const slotWhereFormat =
        timeSlotGranularity === 'hour'
          ? '%Y-%m-%d %H:00:00'
          : '%Y-%m-%d 00:00:00';
      let whereClause = 'WHERE granularity = ?';
      const conditions = [timeSlotGranularity];

      if (startTime) {
        whereClause += ` AND time_slot >= DATE_FORMAT(?, '${slotWhereFormat}')`;
        conditions.push(startTime);
      }
      if (endTime) {
        whereClause += ` AND time_slot <= DATE_FORMAT(?, '${slotWhereFormat}')`;
        conditions.push(endTime);
      }

      const sql = `
        SELECT
          CASE WHEN country = 'US' THEN 'US' ELSE 'EU' END as region_code,
          SUM(check_count) as total_checks,
          SUM(broken_count) as broken_count,
          SUM(CASE WHEN has_peak = 1 THEN check_count ELSE 0 END) as peak_total,
          SUM(CASE WHEN has_peak = 1 THEN broken_count ELSE 0 END) as peak_broken,
          SUM(CASE WHEN has_peak = 0 THEN check_count ELSE 0 END) as low_total,
          SUM(CASE WHEN has_peak = 0 THEN broken_count ELSE 0 END) as low_broken,
          COUNT(*) as total_asins_dedup,
          SUM(CASE WHEN has_broken = 1 THEN 1 ELSE 0 END) as broken_asins_dedup
        FROM monitor_history_agg
        ${whereClause}
        AND country IN ('US', 'UK', 'DE', 'FR', 'IT', 'ES')
        GROUP BY CASE WHEN country = 'US' THEN 'US' ELSE 'EU' END
      `;
      return await query(sql, conditions);
    };

    const getRegionSummaryFromRaw = async () => {
      const slotExpr =
        timeSlotGranularity === 'hour' ? 'mh.hour_ts' : 'mh.day_ts';
      const isPeakCase = MonitorHistory.getPeakHourCase(
        'mh.country',
        'mh.check_time',
      );

      let whereClause = 'WHERE 1=1';
      const conditions = [];

      if (startTime) {
        whereClause += ` AND mh.check_time >= ?`;
        conditions.push(startTime);
      }

      if (endTime) {
        whereClause += ` AND mh.check_time <= ?`;
        conditions.push(endTime);
      }

      const sql = `
        SELECT
          CASE WHEN sub.country = 'US' THEN 'US' ELSE 'EU' END as region_code,
          SUM(sub.check_count) as total_checks,
          SUM(sub.broken_count) as broken_count,
          SUM(CASE WHEN sub.has_peak = 1 THEN sub.check_count ELSE 0 END) as peak_total,
          SUM(CASE WHEN sub.has_peak = 1 THEN sub.broken_count ELSE 0 END) as peak_broken,
          SUM(CASE WHEN sub.has_peak = 0 THEN sub.check_count ELSE 0 END) as low_total,
          SUM(CASE WHEN sub.has_peak = 0 THEN sub.broken_count ELSE 0 END) as low_broken,
          COUNT(*) as total_asins_dedup,
          SUM(CASE WHEN sub.has_broken = 1 THEN 1 ELSE 0 END) as broken_asins_dedup
        FROM (
          SELECT
            ${slotExpr} as slot_raw,
            mh.country,
            COALESCE(mh.asin_id, mh.asin_code) as asin_key,
            COUNT(*) as check_count,
            SUM(CASE WHEN mh.is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
            MAX(mh.is_broken) as has_broken,
            MAX(${isPeakCase}) as has_peak
          FROM monitor_history mh
          ${whereClause}
          AND (mh.asin_id IS NOT NULL OR mh.asin_code IS NOT NULL)
          AND mh.country IN ('US', 'UK', 'DE', 'FR', 'IT', 'ES')
          GROUP BY ${slotExpr}, mh.country, COALESCE(mh.asin_id, mh.asin_code)
        ) sub
        GROUP BY CASE WHEN sub.country = 'US' THEN 'US' ELSE 'EU' END
      `;
      return await query(sql, conditions);
    };

    let resultRows = null;
    const useAgg =
      process.env.ANALYTICS_AGG_ENABLED !== '0' &&
      MonitorHistory.canUseAggForRange(timeSlotGranularity, startTime, endTime);
    if (useAgg) {
      try {
        const isCovered = await MonitorHistory.isAggTableCoveringRange(
          'monitor_history_agg',
          timeSlotGranularity,
          startTime,
          endTime,
        );
        if (!isCovered) {
          logger.info('[统计查询] getRegionSummary 聚合表覆盖不足，回退原始表');
        } else {
          resultRows = await getRegionSummaryFromAgg();
          if (!Array.isArray(resultRows) || resultRows.length === 0) {
            const hasRaw = await MonitorHistory.hasHistoryInRange(
              startTime,
              endTime,
            );
            if (hasRaw) {
              resultRows = null;
            } else {
              resultRows = [];
            }
          } else {
            logger.info('[统计查询] getRegionSummary 使用聚合表');
          }
        }
      } catch (error) {
        logger.warn(
          '[统计查询] getRegionSummary 聚合表读取失败，回退原始表',
          error?.message || error,
        );
        resultRows = null;
      }
    }

    if (!resultRows) {
      resultRows = await getRegionSummaryFromRaw();
    }

    const rowByRegion = new Map();
    for (const row of resultRows) {
      if (row && (row.region_code === 'US' || row.region_code === 'EU')) {
        rowByRegion.set(row.region_code, row);
      }
    }
    const result = ['US', 'EU'].map((regionCode) =>
      buildRegionResult(regionCode, rowByRegion.get(regionCode) || {}),
    );

    // 缓存结果5分钟
    await analyticsCacheService.set(cacheKey, result, 5 * 60 * 1000);
    return result;
  }

  // 周期汇总统计（聚合表版本，用于加速大范围查询）
  static async getPeriodSummaryFromAgg(params = {}) {
    const {
      country = '',
      site = '',
      brand = '',
      startTime = '',
      endTime = '',
      timeSlotGranularity = 'day',
      current = 1,
      pageSize = 10,
    } = params;

    const slotSelectFormat =
      timeSlotGranularity === 'hour' ? '%Y-%m-%d %H:00:00' : '%Y-%m-%d';
    const slotWhereFormat =
      timeSlotGranularity === 'hour'
        ? '%Y-%m-%d %H:00:00'
        : '%Y-%m-%d 00:00:00';

    let whereClause = 'WHERE agg.granularity = ?';
    const conditions = [timeSlotGranularity];
    const useDimAgg = Boolean(site || brand);
    const aggTable = useDimAgg
      ? 'monitor_history_agg_dim'
      : 'monitor_history_agg';

    const isCovered = await MonitorHistory.isAggTableCoveringRange(
      aggTable,
      timeSlotGranularity,
      startTime,
      endTime,
    );
    if (!isCovered) {
      throw new Error(`聚合表覆盖不足，回退原始表: ${aggTable}`);
    }

    if (country) {
      if (country === 'EU') {
        whereClause += ` AND agg.country IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
      } else {
        whereClause += ` AND agg.country = ?`;
        conditions.push(country);
      }
    }

    if (startTime) {
      whereClause += ` AND agg.time_slot >= DATE_FORMAT(?, '${slotWhereFormat}')`;
      conditions.push(startTime);
    }

    if (endTime) {
      whereClause += ` AND agg.time_slot <= DATE_FORMAT(?, '${slotWhereFormat}')`;
      conditions.push(endTime);
    }

    if (useDimAgg && site) {
      whereClause += ` AND agg.site = ?`;
      conditions.push(site);
    }
    if (useDimAgg && brand) {
      whereClause += ` AND agg.brand = ?`;
      conditions.push(brand);
    }

    const selectFields = [
      `DATE_FORMAT(agg.time_slot, '${slotSelectFormat}') as time_slot`,
      'agg.country as country',
      site ? 'agg.site as site' : "'' as site",
      brand ? 'agg.brand as brand' : "'' as brand",
      'SUM(agg.check_count) as total_checks',
      'SUM(agg.broken_count) as broken_count',
      'SUM(CASE WHEN agg.has_peak = 1 THEN agg.check_count ELSE 0 END) as peak_total',
      'SUM(CASE WHEN agg.has_peak = 1 THEN agg.broken_count ELSE 0 END) as peak_broken',
      'SUM(CASE WHEN agg.has_peak = 0 THEN agg.check_count ELSE 0 END) as low_total',
      'SUM(CASE WHEN agg.has_peak = 0 THEN agg.broken_count ELSE 0 END) as low_broken',
      'COUNT(DISTINCT agg.asin_key) as total_asins_dedup',
      'COUNT(DISTINCT CASE WHEN agg.has_broken = 1 THEN agg.asin_key ELSE NULL END) as broken_asins_dedup',
    ];

    const safeCurrent = Math.max(1, Number(current) || 1);
    const safePageSize = Math.max(1, Number(pageSize) || 10);
    const offset = (safeCurrent - 1) * safePageSize;

    const fromClause = `
      FROM ${aggTable} agg
      ${whereClause}
    `;
    const groupByClause = `GROUP BY agg.time_slot, agg.country${
      site ? ', agg.site' : ''
    }${brand ? ', agg.brand' : ''}`;
    const groupedSql = `
      SELECT 
        ${selectFields.join(', ')}
      ${fromClause}
      ${groupByClause}
    `;

    const dataSql = `
      SELECT grouped.*, COUNT(1) OVER() as total_rows
      FROM (
        ${groupedSql}
      ) grouped
      ORDER BY grouped.time_slot ASC, grouped.country ASC${
        site ? ', grouped.site ASC' : ''
      }${brand ? ', grouped.brand ASC' : ''}
      LIMIT ${safePageSize} OFFSET ${offset}
    `;

    const queryStartTime = Date.now();
    const groupedRecords = await query(dataSql, conditions);
    let total = Number(groupedRecords?.[0]?.total_rows) || 0;
    if (groupedRecords.length === 0 && offset > 0) {
      const countSql = `
        SELECT COUNT(1) as total
        FROM (
          ${groupedSql}
        ) grouped
      `;
      const countRows = await query(countSql, conditions);
      total = Number(countRows?.[0]?.total) || 0;
    }
    const queryDuration = Date.now() - queryStartTime;
    logger.info(
      `[聚合查询] getPeriodSummaryFromAgg SQL查询完成（${aggTable}），耗时${queryDuration}ms，返回${groupedRecords.length}条记录，总计${total}条`,
    );

    if (total === 0) {
      const hasRaw = await MonitorHistory.hasHistoryInRange(startTime, endTime);
      if (hasRaw) {
        throw new Error('聚合结果为空，触发回退');
      }
    }

    const result = groupedRecords.map((record) => {
      const totalChecks = Number(record.total_checks) || 0;
      const brokenCount = Number(record.broken_count) || 0;
      const peakTotal = Number(record.peak_total) || 0;
      const peakBroken = Number(record.peak_broken) || 0;
      const lowTotal = Number(record.low_total) || 0;
      const lowBroken = Number(record.low_broken) || 0;
      const totalAsinsDedup = Number(record.total_asins_dedup) || 0;
      const brokenAsinsDedup = Number(record.broken_asins_dedup) || 0;

      const ratioAllAsin =
        totalChecks > 0 ? (brokenCount / totalChecks) * 100 : 0;
      const ratioAllTime =
        totalAsinsDedup > 0 ? (brokenAsinsDedup / totalAsinsDedup) * 100 : 0;
      const globalPeakRate =
        totalChecks > 0 ? (peakBroken / totalChecks) * 100 : 0;
      const globalLowRate =
        totalChecks > 0 ? (lowBroken / totalChecks) * 100 : 0;
      const ratioHigh = peakTotal > 0 ? (peakBroken / peakTotal) * 100 : 0;
      const ratioLow = lowTotal > 0 ? (lowBroken / lowTotal) * 100 : 0;

      return {
        timeSlot: record.time_slot,
        country: record.country,
        site: record.site || '',
        brand: record.brand || '',
        totalChecks,
        ratioAllAsin,
        ratioAllTime,
        globalPeakRate,
        globalLowRate,
        ratioHigh,
        ratioLow,
        brokenCount,
        totalAsinsDedup,
        brokenAsinsDedup,
        peakBroken,
        peakTotal,
        lowBroken,
        lowTotal,
      };
    });

    return {
      list: result,
      total,
      current: safeCurrent,
      pageSize: safePageSize,
    };
  }

  // 周期汇总统计（支持国家/站点/品牌筛选和分页）
  static async getPeriodSummary(params = {}) {
    const {
      country = '',
      site = '',
      brand = '',
      startTime = '',
      endTime = '',
      timeSlotGranularity = 'day',
      current = 1,
      pageSize = 10,
    } = params;

    // 生成缓存键
    const cacheKey = `periodSummary:${country}:${site}:${brand}:${startTime}:${endTime}:${timeSlotGranularity}:${current}:${pageSize}`;
    const periodSummaryCacheTtl =
      Number(process.env.ANALYTICS_PERIOD_SUMMARY_TTL_MS) || 300000;
    const cached = await analyticsCacheService.get(cacheKey);
    if (cached !== null) {
      logger.info(`[缓存命中] getPeriodSummary 缓存键: ${cacheKey}`);
      return cached;
    }
    logger.info(
      `[缓存未命中] getPeriodSummary 缓存键: ${cacheKey}，将查询数据库`,
    );

    let finalResult = null;
    const useAgg =
      process.env.ANALYTICS_AGG_ENABLED !== '0' &&
      MonitorHistory.canUseAggForRange(timeSlotGranularity, startTime, endTime);
    if (useAgg) {
      try {
        finalResult = await MonitorHistory.getPeriodSummaryFromAgg(params);
        logger.info('[统计查询] getPeriodSummary 使用聚合表');
      } catch (error) {
        logger.warn(
          '[统计查询] getPeriodSummary 聚合表读取失败，回退原始表',
          error?.message || error,
        );
        finalResult = null;
      }
    }

    if (finalResult) {
      await analyticsCacheService.set(
        cacheKey,
        finalResult,
        periodSummaryCacheTtl,
      );
      logger.info(
        `[缓存存储] getPeriodSummary 结果已缓存，键: ${cacheKey}，TTL: ${periodSummaryCacheTtl}ms`,
      );
      return finalResult;
    }

    const slotExpr =
      timeSlotGranularity === 'hour' ? 'mh.hour_ts' : 'mh.day_ts';
    const slotSelectExpr =
      timeSlotGranularity === 'hour'
        ? 'DATE_FORMAT(slot_raw, "%Y-%m-%d %H:00:00")'
        : 'DATE_FORMAT(slot_raw, "%Y-%m-%d")';

    // 优化：WHERE子句条件顺序与索引匹配（先country，后check_time）
    // 使用 idx_country_check_time 或 idx_country_check_time_broken 索引
    let whereClause =
      'WHERE (mh.asin_id IS NOT NULL OR mh.asin_code IS NOT NULL)';
    const conditions = [];

    // 先添加country条件（索引的第一列）
    if (country) {
      if (country === 'EU') {
        // EU汇总：包含所有欧洲国家
        whereClause += ` AND mh.country IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
      } else {
        whereClause += ` AND mh.country = ?`;
        conditions.push(country);
      }
    }

    // 再添加check_time条件（索引的第二列）
    if (startTime) {
      whereClause += ` AND mh.check_time >= ?`;
      conditions.push(startTime);
    }

    if (endTime) {
      whereClause += ` AND mh.check_time <= ?`;
      conditions.push(endTime);
    }

    if (site) {
      whereClause += ` AND mh.site_snapshot = ?`;
      conditions.push(site);
    }

    if (brand) {
      whereClause += ` AND mh.brand_snapshot = ?`;
      conditions.push(brand);
    }

    // 优化：将高峰时段判断移到数据库层面
    // 构建高峰时段判断的SQL CASE语句
    // 注意：数据库配置timezone为'+08:00'，所以check_time已经是UTC+8时间
    // 使用DATE_ADD将UTC时间转换为UTC+8，如果数据库存储的是UTC时间
    // 如果数据库已经存储为UTC+8，则直接使用HOUR()函数
    const buildPeakHourCase = (countryField) => {
      // 使用DATE_ADD确保时区转换，如果MySQL没有时区表，使用DATE_ADD作为备选
      // 假设check_time存储为UTC，需要转换为UTC+8（北京时间）
      const hourExpr = `HOUR(DATE_ADD(mh.check_time, INTERVAL 8 HOUR))`;
      return `CASE 
        WHEN ${countryField} = 'US' THEN 
          (${hourExpr} >= 2 AND ${hourExpr} < 6)
          OR (${hourExpr} >= 9 AND ${hourExpr} < 12)
        WHEN ${countryField} = 'UK' THEN
          ${hourExpr} >= 22
          OR (${hourExpr} >= 0 AND ${hourExpr} < 2)
          OR (${hourExpr} >= 3 AND ${hourExpr} < 6)
        WHEN ${countryField} IN ('DE', 'FR', 'ES', 'IT') THEN
          ${hourExpr} >= 20
          OR (${hourExpr} >= 2 AND ${hourExpr} < 5)
        ELSE 0
      END`;
    };

    const isPeakCase = buildPeakHourCase('mh.country');

    // 优化：在数据库层面完成所有聚合计算
    // 使用子查询先按ASIN分组，再按时间槽和维度分组
    const selectFields = [];

    // 构建 SELECT 字段 - 外层查询应使用子查询输出列
    selectFields.push('time_slot');
    selectFields.push('country');
    if (site) {
      selectFields.push('site as site');
    } else {
      selectFields.push("'' as site");
    }
    if (brand) {
      selectFields.push('brand as brand');
    } else {
      selectFields.push("'' as brand");
    }
    // 聚合统计
    selectFields.push('SUM(check_count) as total_checks');
    selectFields.push('SUM(broken_count) as broken_count');
    // 高峰时段统计（在数据库层面计算）
    selectFields.push(
      `SUM(CASE WHEN is_peak = 1 THEN check_count ELSE 0 END) as peak_total`,
    );
    selectFields.push(
      `SUM(CASE WHEN is_peak = 1 THEN broken_count ELSE 0 END) as peak_broken`,
    );
    // 低峰时段统计
    selectFields.push(
      `SUM(CASE WHEN is_peak = 0 THEN check_count ELSE 0 END) as low_total`,
    );
    selectFields.push(
      `SUM(CASE WHEN is_peak = 0 THEN broken_count ELSE 0 END) as low_broken`,
    );
    // 去重统计：使用COUNT(DISTINCT)在数据库层面计算
    selectFields.push(`COUNT(DISTINCT asin_key) as total_asins_dedup`);
    // 去重异常ASIN统计
    selectFields.push(
      `COUNT(DISTINCT CASE WHEN has_broken = 1 THEN asin_key ELSE NULL END) as broken_asins_dedup`,
    );

    // 使用子查询先按ASIN分组，计算高峰时段和异常状态
    const subquerySql = `
      SELECT 
        ${slotExpr} as slot_raw,
        mh.country,
        ${site ? 'mh.site_snapshot as site' : "'' as site"},
        ${brand ? 'mh.brand_snapshot as brand' : "'' as brand"},
        COALESCE(mh.asin_id, mh.asin_code) as asin_key,
        COUNT(*) as check_count,
        SUM(CASE WHEN mh.is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
        MAX(mh.is_broken) as has_broken,
        MAX(${isPeakCase}) as is_peak
      FROM monitor_history mh
      ${whereClause}
      GROUP BY ${slotExpr}, mh.country, COALESCE(mh.asin_id, mh.asin_code)${
      site ? ', mh.site_snapshot' : ''
    }${brand ? ', mh.brand_snapshot' : ''}
    `;

    const safeCurrent = Math.max(1, Number(current) || 1);
    const safePageSize = Math.max(1, Number(pageSize) || 10);
    const offset = (safeCurrent - 1) * safePageSize;

    // 外层查询：按时间槽和维度分组，完成最终聚合
    const fromClause = `
      FROM (
        ${subquerySql}
      ) subquery
    `;
    const groupByClause = `GROUP BY slot_raw, country${site ? ', site' : ''}${
      brand ? ', brand' : ''
    }`;
    const groupedSql = `
      SELECT 
        ${slotSelectExpr} as time_slot,
        ${selectFields.filter((field) => field !== 'time_slot').join(', ')}
      ${fromClause}
      ${groupByClause}
    `;

    const dataSql = `
      SELECT grouped.*, COUNT(1) OVER() as total_rows
      FROM (
        ${groupedSql}
      ) grouped
      ORDER BY grouped.time_slot ASC, grouped.country ASC${
        site ? ', grouped.site ASC' : ''
      }${brand ? ', grouped.brand ASC' : ''}
      LIMIT ${safePageSize} OFFSET ${offset}
    `;

    const queryStartTime = Date.now();
    const groupedRecords = await query(dataSql, conditions);
    let total = Number(groupedRecords?.[0]?.total_rows) || 0;
    if (groupedRecords.length === 0 && offset > 0) {
      const countSql = `
        SELECT COUNT(1) as total
        FROM (
          ${groupedSql}
        ) grouped
      `;
      const countRows = await query(countSql, conditions);
      total = Number(countRows?.[0]?.total) || 0;
    }
    const queryDuration = Date.now() - queryStartTime;
    logger.info(
      `[数据库查询] getPeriodSummary SQL查询完成，耗时${queryDuration}ms，返回${groupedRecords.length}条记录，总计${total}条`,
    );

    // 优化：减少内存计算，大部分计算已在数据库完成
    const list = groupedRecords.map((record) => {
      const totalChecks = Number(record.total_checks) || 0;
      const brokenCount = Number(record.broken_count) || 0;
      const peakTotal = Number(record.peak_total) || 0;
      const peakBroken = Number(record.peak_broken) || 0;
      const lowTotal = Number(record.low_total) || 0;
      const lowBroken = Number(record.low_broken) || 0;
      const totalAsinsDedup = Number(record.total_asins_dedup) || 0;
      const brokenAsinsDedup = Number(record.broken_asins_dedup) || 0;

      // 计算比率（在内存中完成，因为涉及除法）
      const ratioAllAsin =
        totalChecks > 0 ? (brokenCount / totalChecks) * 100 : 0;
      const ratioAllTime =
        totalAsinsDedup > 0 ? (brokenAsinsDedup / totalAsinsDedup) * 100 : 0;
      const globalPeakRate =
        totalChecks > 0 ? (peakBroken / totalChecks) * 100 : 0;
      const globalLowRate =
        totalChecks > 0 ? (lowBroken / totalChecks) * 100 : 0;
      const ratioHigh = peakTotal > 0 ? (peakBroken / peakTotal) * 100 : 0;
      const ratioLow = lowTotal > 0 ? (lowBroken / lowTotal) * 100 : 0;

      return {
        timeSlot: record.time_slot,
        country: record.country,
        site: record.site || '',
        brand: record.brand || '',
        totalChecks,
        ratioAllAsin,
        ratioAllTime,
        globalPeakRate,
        globalLowRate,
        ratioHigh,
        ratioLow,
        brokenCount,
        totalAsinsDedup,
        brokenAsinsDedup,
        peakBroken,
        peakTotal,
        lowBroken,
        lowTotal,
      };
    });

    finalResult = {
      list,
      total,
      current: safeCurrent,
      pageSize: safePageSize,
    };

    await analyticsCacheService.set(
      cacheKey,
      finalResult,
      periodSummaryCacheTtl,
    );
    logger.info(
      `[缓存存储] getPeriodSummary 结果已缓存，键: ${cacheKey}，TTL: ${periodSummaryCacheTtl}ms`,
    );

    return finalResult;
  }

  // 按国家统计ASIN当前状态（基于asins表）
  static async getASINStatisticsByCountry() {
    const sql = `
      SELECT 
        country,
        COUNT(*) as total_asins,
        SUM(CASE WHEN is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
        SUM(CASE WHEN is_broken = 0 THEN 1 ELSE 0 END) as normal_count
      FROM asins
      GROUP BY country
      ORDER BY country ASC
    `;

    const list = await query(sql, []);
    return list;
  }

  // 按变体组统计ASIN当前状态（基于asins表）
  static async getASINStatisticsByVariantGroup(params = {}) {
    const { limit = 10 } = params;
    // 确保limit是正整数
    const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 100));

    const sql = `
      SELECT 
        vg.id as variant_group_id,
        vg.name as variant_group_name,
        vg.country as country,
        COUNT(a.id) as total_asins,
        SUM(CASE WHEN a.is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
        SUM(CASE WHEN a.is_broken = 0 THEN 1 ELSE 0 END) as normal_count
      FROM variant_groups vg
      LEFT JOIN asins a ON a.variant_group_id = vg.id
      WHERE a.id IS NOT NULL
      GROUP BY vg.id, vg.name, vg.country
      HAVING broken_count > 0
      ORDER BY broken_count DESC, total_asins DESC
      LIMIT ${safeLimit}
    `;

    const list = await query(sql, []);
    return list;
  }

  // 获取异常时长统计
  static async getAbnormalDurationStatistics(params = {}) {
    const {
      asinIds = [],
      asinCodes = [],
      variantGroupId = '',
      startTime = '',
      endTime = '',
    } = params;

    // 根据时间范围自动选择时间粒度
    let groupBy = 'day';
    let dateFormat = 'DATE_FORMAT(check_time, "%Y-%m-%d")';
    let intervalHours = 24; // 默认按天，间隔24小时

    if (startTime && endTime) {
      const start = new Date(startTime);
      const end = new Date(endTime);
      const diffHours = (end - start) / (1000 * 60 * 60);

      if (diffHours <= 7 * 24) {
        // 7天以内按小时
        groupBy = 'hour';
        dateFormat = 'DATE_FORMAT(check_time, "%Y-%m-%d %H:00:00")';
        intervalHours = 1;
      } else if (diffHours <= 30 * 24) {
        // 30天以内按天
        groupBy = 'day';
        dateFormat = 'DATE_FORMAT(check_time, "%Y-%m-%d")';
        intervalHours = 24;
      } else {
        // 超过30天按周
        groupBy = 'week';
        // MySQL的WEEK函数，模式3表示ISO周（1-53），格式为：YYYY-WW
        dateFormat =
          'CONCAT(YEAR(check_time), "-", LPAD(WEEK(check_time, 3), 2, "0"))';
        intervalHours = 24 * 7;
      }
    }

    // 构建WHERE条件
    let whereClause = 'WHERE 1=1';
    const conditions = [];

    if (variantGroupId) {
      whereClause += ` AND mh.variant_group_id = ?`;
      conditions.push(variantGroupId);
    }

    if (asinIds && Array.isArray(asinIds) && asinIds.length > 0) {
      const placeholders = asinIds.map(() => '?').join(',');
      whereClause += ` AND mh.asin_id IN (${placeholders})`;
      conditions.push(...asinIds);
    }

    if (asinCodes && Array.isArray(asinCodes) && asinCodes.length > 0) {
      const placeholders = asinCodes.map(() => '?').join(',');
      whereClause += ` AND COALESCE(mh.asin_code, a.asin) IN (${placeholders})`;
      conditions.push(...asinCodes);
    }

    if (startTime) {
      whereClause += ` AND mh.check_time >= ?`;
      conditions.push(startTime);
    }

    if (endTime) {
      whereClause += ` AND mh.check_time <= ?`;
      conditions.push(endTime);
    }

    // 查询每个时间粒度内每个ASIN的异常记录数
    // 假设检查间隔为1小时（根据定时任务配置）
    const checkIntervalHours = 1;

    const sql = `
      SELECT 
        ${dateFormat} as time_period,
        mh.asin_id,
        COALESCE(mh.asin_code, a.asin) as asin,
        COUNT(*) as total_checks,
        SUM(CASE WHEN mh.is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
        SUM(CASE WHEN mh.is_broken = 0 THEN 1 ELSE 0 END) as normal_count
      FROM monitor_history mh
      LEFT JOIN asins a ON a.id = mh.asin_id
      ${whereClause}
      AND mh.asin_id IS NOT NULL
      GROUP BY ${dateFormat}, mh.asin_id, COALESCE(mh.asin_code, a.asin)
      ORDER BY time_period ASC, mh.asin_id ASC
    `;

    const results = await query(sql, conditions);

    // 处理数据：计算异常时长和占比
    const processedData = results.map((row) => {
      const brokenCount = row.broken_count || 0;
      const totalChecks = row.total_checks || 0;

      // 异常时长 = 异常记录数 × 检查间隔（小时）
      // 每个异常记录代表该ASIN在检查间隔时间内处于异常状态
      // 注意：US区域检查间隔是30分钟（0.5小时），EU区域是1小时
      // 这里使用1小时作为默认值，实际应该根据国家区分，但为了简化，统一使用1小时
      const abnormalDuration = brokenCount * checkIntervalHours;

      // 总时长 = 时间粒度长度（小时）
      const totalDuration = intervalHours;

      // 异常占比 = 异常记录数 / 总记录数 × 100%
      // 这表示在该时间粒度内，异常检查次数占总检查次数的百分比
      const abnormalRatio =
        totalChecks > 0 ? (brokenCount / totalChecks) * 100 : 0;

      return {
        timePeriod: row.time_period,
        asinId: row.asin_id,
        asin: row.asin,
        abnormalDuration: Number(abnormalDuration.toFixed(2)),
        totalDuration: totalDuration,
        abnormalRatio: Number(abnormalRatio.toFixed(2)),
        brokenCount: brokenCount,
        totalChecks: totalChecks,
      };
    });

    // 填充完整的时间序列（包括没有数据的时间点）
    if (startTime && endTime) {
      const start = new Date(startTime);
      const end = new Date(endTime);

      // 获取所有唯一的ASIN
      const asinSet = new Set();
      processedData.forEach((item) => {
        if (item.asinId) {
          asinSet.add(JSON.stringify({ asinId: item.asinId, asin: item.asin }));
        }
      });

      // 生成完整的时间序列
      const timeSeries = [];
      const current = new Date(start);
      // 将时间设置为当天的开始（对于按天和周）
      if (groupBy === 'day' || groupBy === 'week') {
        current.setHours(0, 0, 0, 0);
      } else if (groupBy === 'hour') {
        current.setMinutes(0, 0, 0);
      }

      while (current <= end) {
        let timePeriod;
        if (groupBy === 'hour') {
          // 格式：YYYY-MM-DD HH:00:00
          const year = current.getFullYear();
          const month = String(current.getMonth() + 1).padStart(2, '0');
          const day = String(current.getDate()).padStart(2, '0');
          const hour = String(current.getHours()).padStart(2, '0');
          timePeriod = `${year}-${month}-${day} ${hour}:00:00`;
          current.setHours(current.getHours() + 1);
        } else if (groupBy === 'day') {
          // 格式：YYYY-MM-DD
          const year = current.getFullYear();
          const month = String(current.getMonth() + 1).padStart(2, '0');
          const day = String(current.getDate()).padStart(2, '0');
          timePeriod = `${year}-${month}-${day}`;
          current.setDate(current.getDate() + 1);
        } else if (groupBy === 'week') {
          // 格式：YYYY-WW（与MySQL的DATE_FORMAT(check_time, "%Y-%u")匹配）
          const year = current.getFullYear();
          // MySQL的WEEK函数默认模式是0，返回0-53，但我们需要ISO周（1-53）
          // 使用WEEK(date, 3)返回ISO周数
          // 这里我们使用JavaScript计算ISO周数
          const week = MonitorHistory.getWeekNumber(current);
          timePeriod = `${year}-${week.toString().padStart(2, '0')}`;
          current.setDate(current.getDate() + 7);
        }

        if (timePeriod) {
          timeSeries.push(timePeriod);
        }
      }

      // 为每个ASIN填充完整的时间序列
      const filledData = [];
      asinSet.forEach((asinKey) => {
        const { asinId, asin } = JSON.parse(asinKey);
        timeSeries.forEach((timePeriod) => {
          // 查找是否有该时间点的数据
          const existingData = processedData.find(
            (item) => item.timePeriod === timePeriod && item.asinId === asinId,
          );

          if (existingData) {
            // 使用已有数据
            filledData.push(existingData);
          } else {
            // 填充空数据（0值）
            filledData.push({
              timePeriod: timePeriod,
              asinId: asinId,
              asin: asin,
              abnormalDuration: 0,
              totalDuration: intervalHours,
              abnormalRatio: 0,
              brokenCount: 0,
              totalChecks: 0,
            });
          }
        });
      });

      // 如果没有任何ASIN数据，至少返回时间序列（用于显示空图表）
      if (filledData.length === 0 && timeSeries.length > 0) {
        timeSeries.forEach((timePeriod) => {
          filledData.push({
            timePeriod: timePeriod,
            asinId: null,
            asin: null,
            abnormalDuration: 0,
            totalDuration: intervalHours,
            abnormalRatio: 0,
            brokenCount: 0,
            totalChecks: 0,
          });
        });
      }

      return {
        timeGranularity: groupBy,
        data: filledData,
      };
    }

    // 如果没有时间范围，直接返回处理后的数据
    return {
      timeGranularity: groupBy,
      data: processedData,
    };
  }

  // 辅助函数：获取周数（ISO周）
  static getWeekNumber(date) {
    const d = new Date(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
    );
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  }

  // 更新监控历史记录的通知状态
  // 更新指定国家、检查时间段内，异常（is_broken = 1）的监控历史记录的通知状态
  static async updateNotificationStatus(
    country,
    checkTime,
    notificationSent = 1,
  ) {
    // 将 checkTime 转换为 Date 对象（如果还不是）
    const checkTimeDate =
      checkTime instanceof Date ? checkTime : new Date(checkTime);

    // 计算时间范围：从检查时间前1分钟到后2分钟（允许一定的误差）
    const timeStart = new Date(checkTimeDate.getTime() - 60 * 1000); // 前1分钟
    const timeEnd = new Date(checkTimeDate.getTime() + 2 * 60 * 1000); // 后2分钟

    // 更新指定国家、时间范围内，异常状态的监控历史记录
    const result = await query(
      `UPDATE monitor_history 
       SET notification_sent = ? 
       WHERE country = ? 
         AND check_time >= ? 
         AND check_time <= ?
         AND is_broken = 1
         AND notification_sent = 0`,
      [notificationSent ? 1 : 0, country, timeStart, timeEnd],
    );

    // 清除相关缓存
    cacheService.deleteByPrefix('monitorHistoryCount:');
    void cacheService.deleteByPrefixAsync('monitorHistoryCount:');

    return result.affectedRows || 0;
  }

  // 查询ASIN状态变动记录
  // 使用窗口函数 LAG 来识别状态变化
  static async findStatusChanges(params = {}) {
    const {
      variantGroupId = '',
      asinId = '',
      asin = '',
      country = '',
      checkType = '',
      startTime = '',
      endTime = '',
      current = 1,
      pageSize = 10,
    } = params;

    // 构建基础查询，使用窗口函数识别状态变化
    let sql = `
      WITH status_history AS (
        SELECT 
          mh.id,
          mh.variant_group_id,
          mh.asin_id,
          mh.check_type,
          mh.country,
          mh.is_broken,
          mh.check_time,
          mh.check_result,
          mh.notification_sent,
          mh.create_time,
          COALESCE(mh.variant_group_name, vg.name) as variant_group_name,
          COALESCE(mh.asin_code, a.asin) as asin,
          COALESCE(mh.asin_name, a.name) as asin_name,
          a.asin_type as asin_type,
          LAG(mh.is_broken) OVER (
            PARTITION BY mh.asin_id, mh.country 
            ORDER BY mh.check_time
          ) as prev_is_broken
        FROM monitor_history mh
        LEFT JOIN variant_groups vg ON vg.id = mh.variant_group_id
        LEFT JOIN asins a ON a.id = mh.asin_id
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
      if (Array.isArray(asin) && asin.length > 0) {
        const placeholders = asin.map(() => '?').join(',');
        sql += ` AND (COALESCE(mh.asin_code, a.asin) IN (${placeholders}))`;
        conditions.push(...asin);
      } else if (typeof asin === 'string') {
        sql += ` AND (COALESCE(mh.asin_code, a.asin) LIKE ?)`;
        conditions.push(`%${asin}%`);
      }
    }

    if (country) {
      if (country === 'EU') {
        sql += ` AND mh.country IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
      } else {
        sql += ` AND mh.country = ?`;
        conditions.push(country);
      }
    }

    if (checkType) {
      sql += ` AND mh.check_type = ?`;
      conditions.push(checkType);
    }

    if (startTime) {
      sql += ` AND mh.check_time >= ?`;
      conditions.push(startTime);
    }

    if (endTime) {
      sql += ` AND mh.check_time <= ?`;
      conditions.push(endTime);
    }

    // 只选择状态发生变化的记录（排除第一条记录，因为 prev_is_broken 为 NULL）
    sql += `
      )
      SELECT * FROM status_history
      WHERE prev_is_broken IS NOT NULL
        AND prev_is_broken != is_broken
      ORDER BY check_time DESC
    `;

    // 计算总数（先查询总数）
    const countKey = `statusChangesCount:${variantGroupId || 'ALL'}:${
      asinId || 'ALL'
    }:${asin || 'ALL'}:${country || 'ALL'}:${checkType || 'ALL'}:${
      startTime || 'ALL'
    }:${endTime || 'ALL'}`;
    let total = await cacheService.getAsync(countKey);
    if (total === null) {
      let countSql = `
        WITH status_history AS (
          SELECT 
            mh.id,
            mh.asin_id,
            mh.country,
            mh.is_broken,
            LAG(mh.is_broken) OVER (
              PARTITION BY mh.asin_id, mh.country 
              ORDER BY mh.check_time
            ) as prev_is_broken
          FROM monitor_history mh
          WHERE 1=1
      `;
      const countConditions = [];

      if (variantGroupId) {
        countSql += ` AND mh.variant_group_id = ?`;
        countConditions.push(variantGroupId);
      }

      if (asinId) {
        countSql += ` AND mh.asin_id = ?`;
        countConditions.push(asinId);
      }

      if (asin) {
        if (Array.isArray(asin) && asin.length > 0) {
          const placeholders = asin.map(() => '?').join(',');
          countSql += ` AND mh.asin_code IN (${placeholders})`;
          countConditions.push(...asin);
        } else if (typeof asin === 'string') {
          countSql += ` AND mh.asin_code LIKE ?`;
          countConditions.push(`%${asin}%`);
        }
      }

      if (country) {
        if (country === 'EU') {
          countSql += ` AND mh.country IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
        } else {
          countSql += ` AND mh.country = ?`;
          countConditions.push(country);
        }
      }

      if (checkType) {
        countSql += ` AND mh.check_type = ?`;
        countConditions.push(checkType);
      }

      if (startTime) {
        countSql += ` AND mh.check_time >= ?`;
        countConditions.push(startTime);
      }

      if (endTime) {
        countSql += ` AND mh.check_time <= ?`;
        countConditions.push(endTime);
      }

      countSql += `
        )
        SELECT COUNT(*) as total FROM status_history
        WHERE prev_is_broken IS NOT NULL
          AND prev_is_broken != is_broken
      `;

      const countResult = await query(countSql, countConditions);
      total = countResult[0]?.total || 0;
      await cacheService.setAsync(countKey, total, 60 * 1000);
    }

    // 分页
    const offset = (Number(current) - 1) * Number(pageSize);
    const limit = Number(pageSize);
    sql += ` LIMIT ${limit} OFFSET ${offset}`;

    const list = await query(sql, conditions);

    // 转换字段名
    const formattedList = list.map((item) => ({
      ...item,
      checkTime: item.check_time,
      checkType: item.check_type,
      isBroken: item.is_broken,
      prevIsBroken: item.prev_is_broken,
      notificationSent: item.notification_sent,
      variantGroupName: item.variant_group_name,
      asinName: item.asin_name,
      asinType: item.asin_type,
      createTime: item.create_time,
      statusChange: item.prev_is_broken === 0 ? '正常→异常' : '异常→正常',
    }));

    return {
      list: formattedList,
      total,
      current: Number(current),
      pageSize: Number(pageSize),
    };
  }

  // 流式查询状态变动记录（用于大数据量导出）
  // 使用分页批量查询，避免一次性加载所有数据
  static async findStatusChangesStream(params = {}, onRow, batchSize = 10000) {
    const {
      variantGroupId = '',
      asinId = '',
      asin = '',
      country = '',
      checkType = '',
      startTime = '',
      endTime = '',
    } = params;

    // 先获取总数
    const countKey = `statusChangesCount:${variantGroupId || 'ALL'}:${
      asinId || 'ALL'
    }:${asin || 'ALL'}:${country || 'ALL'}:${checkType || 'ALL'}:${
      startTime || 'ALL'
    }:${endTime || 'ALL'}`;
    let total = await cacheService.getAsync(countKey);

    if (total === null) {
      // 使用与 findStatusChanges 相同的计数逻辑
      let countSql = `
        WITH status_history AS (
          SELECT 
            mh.id,
            mh.asin_id,
            mh.country,
            mh.is_broken,
            LAG(mh.is_broken) OVER (
              PARTITION BY mh.asin_id, mh.country 
              ORDER BY mh.check_time
            ) as prev_is_broken
          FROM monitor_history mh
          WHERE 1=1
      `;
      const countConditions = [];

      if (variantGroupId) {
        countSql += ` AND mh.variant_group_id = ?`;
        countConditions.push(variantGroupId);
      }

      if (asinId) {
        countSql += ` AND mh.asin_id = ?`;
        countConditions.push(asinId);
      }

      if (asin) {
        if (Array.isArray(asin) && asin.length > 0) {
          const placeholders = asin.map(() => '?').join(',');
          countSql += ` AND mh.asin_code IN (${placeholders})`;
          countConditions.push(...asin);
        } else if (typeof asin === 'string') {
          countSql += ` AND mh.asin_code LIKE ?`;
          countConditions.push(`%${asin}%`);
        }
      }

      if (country) {
        if (country === 'EU') {
          countSql += ` AND mh.country IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
        } else {
          countSql += ` AND mh.country = ?`;
          countConditions.push(country);
        }
      }

      if (checkType) {
        countSql += ` AND mh.check_type = ?`;
        countConditions.push(checkType);
      }

      if (startTime) {
        countSql += ` AND mh.check_time >= ?`;
        countConditions.push(startTime);
      }

      if (endTime) {
        countSql += ` AND mh.check_time <= ?`;
        countConditions.push(endTime);
      }

      countSql += `
        )
        SELECT COUNT(*) as total FROM status_history
        WHERE prev_is_broken IS NOT NULL
          AND prev_is_broken != is_broken
      `;

      const countResult = await query(countSql, countConditions);
      total = countResult[0]?.total || 0;
      await cacheService.setAsync(countKey, total, 60 * 1000);
    }

    // 分页批量查询
    const totalPages = Math.ceil(total / batchSize);
    for (let page = 1; page <= totalPages; page++) {
      const offset = (page - 1) * batchSize;
      const limit = batchSize;

      let sql = `
        WITH status_history AS (
          SELECT 
            mh.id,
            mh.variant_group_id,
            mh.asin_id,
            mh.check_type,
            mh.country,
            mh.is_broken,
            mh.check_time,
            mh.check_result,
            mh.notification_sent,
            mh.create_time,
            COALESCE(mh.variant_group_name, vg.name) as variant_group_name,
            COALESCE(mh.asin_code, a.asin) as asin,
            COALESCE(mh.asin_name, a.name) as asin_name,
            a.asin_type as asin_type,
            LAG(mh.is_broken) OVER (
              PARTITION BY mh.asin_id, mh.country 
              ORDER BY mh.check_time
            ) as prev_is_broken
          FROM monitor_history mh
          LEFT JOIN variant_groups vg ON vg.id = mh.variant_group_id
          LEFT JOIN asins a ON a.id = mh.asin_id
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
        if (Array.isArray(asin) && asin.length > 0) {
          const placeholders = asin.map(() => '?').join(',');
          sql += ` AND (COALESCE(mh.asin_code, a.asin) IN (${placeholders}))`;
          conditions.push(...asin);
        } else if (typeof asin === 'string') {
          sql += ` AND (COALESCE(mh.asin_code, a.asin) LIKE ?)`;
          conditions.push(`%${asin}%`);
        }
      }

      if (country) {
        if (country === 'EU') {
          sql += ` AND mh.country IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
        } else {
          sql += ` AND mh.country = ?`;
          conditions.push(country);
        }
      }

      if (checkType) {
        sql += ` AND mh.check_type = ?`;
        conditions.push(checkType);
      }

      if (startTime) {
        sql += ` AND mh.check_time >= ?`;
        conditions.push(startTime);
      }

      if (endTime) {
        sql += ` AND mh.check_time <= ?`;
        conditions.push(endTime);
      }

      sql += `
        )
        SELECT * FROM status_history
        WHERE prev_is_broken IS NOT NULL
          AND prev_is_broken != is_broken
        ORDER BY check_time DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const rows = await query(sql, conditions);

      // 处理每一行
      for (const row of rows) {
        const formattedRow = {
          ...row,
          checkTime: row.check_time,
          checkType: row.check_type,
          isBroken: row.is_broken,
          prevIsBroken: row.prev_is_broken,
          notificationSent: row.notification_sent,
          variantGroupName: row.variant_group_name,
          asinName: row.asin_name,
          asinType: row.asin_type,
          createTime: row.create_time,
          statusChange: row.prev_is_broken === 0 ? '正常→异常' : '异常→正常',
        };
        await onRow(formattedRow);
      }
    }
  }
}

module.exports = MonitorHistory;
