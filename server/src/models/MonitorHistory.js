const { query } = require('../config/database');
const cacheService = require('../services/cacheService');
const logger = require('../utils/logger');

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
    let total = cacheService.get(countKey);
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
      cacheService.set(countKey, total, 60 * 1000);
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
      checkType,
      country,
      isBroken,
      checkTime,
      checkResult,
    } = data;

    const result = await query(
      `INSERT INTO monitor_history 
       (variant_group_id, variant_group_name, asin_id, asin_code, asin_name, check_type, country, is_broken, check_time, check_result) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        variantGroupId || null,
        variantGroupName || null,
        asinId || null,
        asinCode || null,
        asinName || null,
        checkType || 'GROUP',
        country,
        isBroken ? 1 : 0,
        checkTime || new Date(),
        checkResult ? JSON.stringify(checkResult) : null,
      ],
    );

    cacheService.deleteByPrefix('monitorHistoryCount:');
    return this.findById(result.insertId);
  }

  static async bulkCreate(entries = []) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return;
    }

    const placeholders = [];
    const values = [];
    for (const entry of entries) {
      placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      values.push(
        entry.variantGroupId || null,
        entry.variantGroupName || null,
        entry.asinId || null,
        entry.asinCode || null,
        entry.asinName || null,
        entry.checkType || 'GROUP',
        entry.country || null,
        entry.isBroken ? 1 : 0,
        entry.checkTime || new Date(),
        entry.checkResult ? JSON.stringify(entry.checkResult) : null,
      );
    }

    const sql = `INSERT INTO monitor_history 
      (variant_group_id, variant_group_name, asin_id, asin_code, asin_name, check_type, country, is_broken, check_time, check_result) 
      VALUES ${placeholders.join(', ')}`;

    await query(sql, values);
    cacheService.deleteByPrefix('monitorHistoryCount:');
    // 清除统计查询缓存
    cacheService.deleteByPrefix('statisticsByTime:');
    cacheService.deleteByPrefix('allCountriesSummary:');
    cacheService.deleteByPrefix('regionSummary:');
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

  // 按时间分组统计
  static async getStatisticsByTime(params = {}) {
    const {
      country = '',
      startTime = '',
      endTime = '',
      groupBy = 'day',
    } = params;

    // 生成缓存键
    const cacheKey = `statisticsByTime:${country}:${startTime}:${endTime}:${groupBy}`;
    const cached = cacheService.get(cacheKey);
    if (cached !== null) {
      return cached;
    }

    let dateFormat = '';
    if (groupBy === 'day') {
      dateFormat = 'DATE_FORMAT(check_time, "%Y-%m-%d")';
    } else if (groupBy === 'hour') {
      dateFormat = 'DATE_FORMAT(check_time, "%Y-%m-%d %H:00:00")';
    } else if (groupBy === 'week') {
      dateFormat = 'DATE_FORMAT(check_time, "%Y-%u")';
    } else if (groupBy === 'month') {
      dateFormat = 'DATE_FORMAT(check_time, "%Y-%m")';
    } else {
      dateFormat = 'DATE_FORMAT(check_time, "%Y-%m-%d")';
    }

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

    // 使用子查询计算ASIN异常占比
    // ratio_all_asin: 异常快照数 / 总快照数 × 100%（快照口径）
    // ratio_all_time: 按 (国家 + ASIN + 时间槽) 去重后，异常ASIN数 / 总ASIN数 × 100%（去重口径）
    let sql = `
      SELECT 
        t.time_period,
        t.total_checks,
        t.broken_count,
        t.normal_count,
        -- ratio_all_asin: 异常快照数 / 总快照数 × 100%
        CASE 
          WHEN t.total_checks > 0 
          THEN (t.broken_count / t.total_checks) * 100
          ELSE 0 
        END as ratio_all_asin,
        -- 去重口径统计：按 (国家 + ASIN + 时间槽) 去重
        COALESCE(dedup_stats.total_asins, 0) as total_asins_dedup,
        COALESCE(dedup_stats.broken_asins, 0) as broken_asins_dedup,
        -- ratio_all_time: 异常ASIN数 / 总ASIN数 × 100%（去重口径）
        CASE 
          WHEN COALESCE(dedup_stats.total_asins, 0) > 0 
          THEN (COALESCE(dedup_stats.broken_asins, 0) / COALESCE(dedup_stats.total_asins, 1)) * 100
          ELSE 0 
        END as ratio_all_time,
        -- 保留原有的ASIN统计（用于兼容）
        COALESCE(asin_stats.total_asins, 0) as total_asins,
        COALESCE(asin_stats.broken_asins, 0) as broken_asins,
        CASE 
          WHEN COALESCE(asin_stats.total_asins, 0) > 0 
          THEN (COALESCE(asin_stats.broken_asins, 0) / COALESCE(asin_stats.total_asins, 1)) * 100
          ELSE 0 
        END as asin_broken_rate
      FROM (
        SELECT 
          ${dateFormat} as time_period,
          COUNT(*) as total_checks,
          SUM(CASE WHEN is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
          SUM(CASE WHEN is_broken = 0 THEN 1 ELSE 0 END) as normal_count
        FROM monitor_history
        ${whereClause}
        GROUP BY ${dateFormat}
      ) t
      LEFT JOIN (
        -- 去重口径：按 (国家 + ASIN + 时间槽) 去重，若该ASIN在该时间槽内任意一次快照为异常，则计为异常
        SELECT 
          time_period,
          COUNT(*) as total_asins,
          SUM(CASE WHEN has_broken > 0 THEN 1 ELSE 0 END) as broken_asins
        FROM (
          SELECT 
            ${dateFormat} as time_period,
            country,
            asin_id,
            MAX(CASE WHEN is_broken = 1 THEN 1 ELSE 0 END) as has_broken
          FROM monitor_history
          ${whereClause}
          AND asin_id IS NOT NULL
          GROUP BY ${dateFormat}, country, asin_id
        ) dedup_grouped
        GROUP BY time_period
      ) dedup_stats ON t.time_period = dedup_stats.time_period
      LEFT JOIN (
        -- 原有统计（按时间槽去重，但不按国家）
        SELECT 
          ${dateFormat} as time_period,
          COUNT(DISTINCT asin_id) as total_asins,
          COUNT(DISTINCT CASE WHEN is_broken = 1 THEN asin_id END) as broken_asins
        FROM monitor_history
        ${whereClause}
        AND asin_id IS NOT NULL
        GROUP BY ${dateFormat}
      ) asin_stats ON t.time_period = asin_stats.time_period
      ORDER BY t.time_period ASC
    `;

    const list = await query(sql, allConditions);

    // 缓存结果5分钟
    cacheService.set(cacheKey, list, 5 * 60 * 1000);
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

  // 全部国家汇总统计
  static async getAllCountriesSummary(params = {}) {
    const {
      startTime = '',
      endTime = '',
      timeSlotGranularity = 'day',
    } = params;

    // 生成缓存键
    const cacheKey = `allCountriesSummary:${startTime}:${endTime}:${timeSlotGranularity}`;
    const cached = cacheService.get(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const { isPeakHour } = require('../utils/peakHours');

    let dateFormat = '';
    if (timeSlotGranularity === 'hour') {
      dateFormat = 'DATE_FORMAT(check_time, "%Y-%m-%d %H:00:00")';
    } else {
      dateFormat = 'DATE_FORMAT(check_time, "%Y-%m-%d")';
    }

    let whereClause = 'WHERE 1=1';
    const conditions = [];

    if (startTime) {
      whereClause += ` AND check_time >= ?`;
      conditions.push(startTime);
    }

    if (endTime) {
      whereClause += ` AND check_time <= ?`;
      conditions.push(endTime);
    }

    // 优化：使用数据库 GROUP BY 聚合，减少内存占用
    // 先按时间槽、国家、ASIN分组，在数据库层面聚合
    const sql = `
      SELECT 
        ${dateFormat} as time_slot,
        country,
        asin_id,
        COUNT(*) as check_count,
        SUM(CASE WHEN is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
        MAX(is_broken) as has_broken,
        MIN(check_time) as first_check_time
      FROM monitor_history
      ${whereClause}
      AND asin_id IS NOT NULL
      GROUP BY ${dateFormat}, country, asin_id
      ORDER BY first_check_time ASC
    `;

    const groupedRecords = await query(sql, conditions);

    // 在内存中计算指标（数据量已大大减少）
    let totalChecks = 0;
    let brokenCount = 0;
    let peakBroken = 0;
    let peakTotal = 0;
    let lowBroken = 0;
    let lowTotal = 0;

    // 用于去重统计：按 (国家 + ASIN + 时间槽) 去重
    const dedupMap = new Map(); // key: country_asin_timeSlot, value: { isBroken: boolean }

    groupedRecords.forEach((record) => {
      const checkCount = Number(record.check_count) || 0;
      const brokenCountInGroup = Number(record.broken_count) || 0;
      const hasBroken = record.has_broken === 1;

      totalChecks += checkCount;
      brokenCount += brokenCountInGroup;

      // 判断是否在高峰时段（使用该组的第一个检查时间）
      const checkTime = new Date(record.first_check_time);
      const isPeak = isPeakHour(checkTime, record.country);

      if (isPeak) {
        peakTotal += checkCount;
        peakBroken += brokenCountInGroup;
      } else {
        lowTotal += checkCount;
        lowBroken += brokenCountInGroup;
      }

      // 去重统计：按 (国家 + ASIN + 时间槽) 去重
      const dedupKey = `${record.country}_${record.asin_id}_${record.time_slot}`;
      if (!dedupMap.has(dedupKey)) {
        dedupMap.set(dedupKey, { isBroken: false });
      }
      // 如果该ASIN在该时间槽内任意一次快照为异常，则计为异常
      if (hasBroken) {
        dedupMap.get(dedupKey).isBroken = true;
      }
    });

    // 计算去重口径的ASIN数
    let totalAsinsDedup = dedupMap.size;
    let brokenAsinsDedup = 0;
    dedupMap.forEach((value) => {
      if (value.isBroken) {
        brokenAsinsDedup++;
      }
    });

    // 计算所有指标
    const ratioAllAsin =
      totalChecks > 0 ? (brokenCount / totalChecks) * 100 : 0;
    const ratioAllTime =
      totalAsinsDedup > 0 ? (brokenAsinsDedup / totalAsinsDedup) * 100 : 0;
    const globalPeakRate =
      totalChecks > 0 ? (peakBroken / totalChecks) * 100 : 0;
    const globalLowRate = totalChecks > 0 ? (lowBroken / totalChecks) * 100 : 0;
    const ratioHigh = peakTotal > 0 ? (peakBroken / peakTotal) * 100 : 0;
    const ratioLow = lowTotal > 0 ? (lowBroken / lowTotal) * 100 : 0;

    const result = {
      timeRange: startTime && endTime ? `${startTime} ~ ${endTime}` : '',
      totalChecks,
      ratioAllAsin,
      ratioAllTime,
      globalPeakRate,
      globalLowRate,
      ratioHigh,
      ratioLow,
      // 详细数据
      brokenCount,
      totalAsinsDedup,
      brokenAsinsDedup,
      peakBroken,
      peakTotal,
      lowBroken,
      lowTotal,
    };

    // 缓存结果5分钟
    cacheService.set(cacheKey, result, 5 * 60 * 1000);
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
    const cached = cacheService.get(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const { isPeakHour } = require('../utils/peakHours');

    let dateFormat = '';
    if (timeSlotGranularity === 'hour') {
      dateFormat = 'DATE_FORMAT(check_time, "%Y-%m-%d %H:00:00")';
    } else {
      dateFormat = 'DATE_FORMAT(check_time, "%Y-%m-%d")';
    }

    let whereClause = 'WHERE 1=1';
    const conditions = [];

    if (startTime) {
      whereClause += ` AND check_time >= ?`;
      conditions.push(startTime);
    }

    if (endTime) {
      whereClause += ` AND check_time <= ?`;
      conditions.push(endTime);
    }

    // 优化：使用数据库 GROUP BY 聚合，减少内存占用
    // 先按时间槽、国家、ASIN分组，在数据库层面聚合
    const sql = `
      SELECT 
        ${dateFormat} as time_slot,
        country,
        asin_id,
        COUNT(*) as check_count,
        SUM(CASE WHEN is_broken = 1 THEN 1 ELSE 0 END) as broken_count,
        MAX(is_broken) as has_broken,
        MIN(check_time) as first_check_time
      FROM monitor_history
      ${whereClause}
      AND asin_id IS NOT NULL
      AND country IN ('US', 'UK', 'DE', 'FR', 'IT', 'ES')
      GROUP BY ${dateFormat}, country, asin_id
      ORDER BY first_check_time ASC
    `;

    const groupedRecords = await query(sql, conditions);

    // 区域划分：US为美国，UK/DE/FR/IT/ES为欧洲
    const regionMap = {
      US: 'US',
      UK: 'EU',
      DE: 'EU',
      FR: 'EU',
      IT: 'EU',
      ES: 'EU',
    };

    // 按区域统计
    const regionStats = {
      US: {
        totalChecks: 0,
        brokenCount: 0,
        peakBroken: 0,
        peakTotal: 0,
        lowBroken: 0,
        lowTotal: 0,
        dedupMap: new Map(),
      },
      EU: {
        totalChecks: 0,
        brokenCount: 0,
        peakBroken: 0,
        peakTotal: 0,
        lowBroken: 0,
        lowTotal: 0,
        dedupMap: new Map(),
      },
    };

    // 在内存中计算指标（数据量已大大减少）
    groupedRecords.forEach((record) => {
      const region = regionMap[record.country] || 'OTHER';
      if (region === 'OTHER') return;

      const stats = regionStats[region];
      const checkCount = Number(record.check_count) || 0;
      const brokenCountInGroup = Number(record.broken_count) || 0;
      const hasBroken = record.has_broken === 1;

      stats.totalChecks += checkCount;
      stats.brokenCount += brokenCountInGroup;

      // 判断是否在高峰时段（使用该组的第一个检查时间）
      const checkTime = new Date(record.first_check_time);
      const isPeak = isPeakHour(checkTime, record.country);
      if (isPeak) {
        stats.peakTotal += checkCount;
        stats.peakBroken += brokenCountInGroup;
      } else {
        stats.lowTotal += checkCount;
        stats.lowBroken += brokenCountInGroup;
      }

      // 去重统计：按 (国家 + ASIN + 时间槽) 去重
      const dedupKey = `${record.country}_${record.asin_id}_${record.time_slot}`;
      if (!stats.dedupMap.has(dedupKey)) {
        stats.dedupMap.set(dedupKey, { isBroken: false });
      }
      // 如果该ASIN在该时间槽内任意一次快照为异常，则计为异常
      if (hasBroken) {
        stats.dedupMap.get(dedupKey).isBroken = true;
      }
    });

    // 计算每个区域的指标
    const result = [];
    Object.keys(regionStats).forEach((region) => {
      const stats = regionStats[region];
      const totalAsinsDedup = stats.dedupMap.size;
      let brokenAsinsDedup = 0;
      stats.dedupMap.forEach((value) => {
        if (value.isBroken) {
          brokenAsinsDedup++;
        }
      });

      const ratioAllAsin =
        stats.totalChecks > 0
          ? (stats.brokenCount / stats.totalChecks) * 100
          : 0;
      const ratioAllTime =
        totalAsinsDedup > 0 ? (brokenAsinsDedup / totalAsinsDedup) * 100 : 0;
      const globalPeakRate =
        stats.totalChecks > 0
          ? (stats.peakBroken / stats.totalChecks) * 100
          : 0;
      const globalLowRate =
        stats.totalChecks > 0 ? (stats.lowBroken / stats.totalChecks) * 100 : 0;
      const ratioHigh =
        stats.peakTotal > 0 ? (stats.peakBroken / stats.peakTotal) * 100 : 0;
      const ratioLow =
        stats.lowTotal > 0 ? (stats.lowBroken / stats.lowTotal) * 100 : 0;

      result.push({
        region: region === 'US' ? '美国' : '欧洲',
        regionCode: region,
        timeRange: startTime && endTime ? `${startTime} ~ ${endTime}` : '',
        totalChecks: stats.totalChecks,
        ratioAllAsin,
        ratioAllTime,
        globalPeakRate,
        globalLowRate,
        ratioHigh,
        ratioLow,
        brokenCount: stats.brokenCount,
        totalAsinsDedup,
        brokenAsinsDedup,
        peakBroken: stats.peakBroken,
        peakTotal: stats.peakTotal,
        lowBroken: stats.lowBroken,
        lowTotal: stats.lowTotal,
      });
    });

    // 缓存结果5分钟
    cacheService.set(cacheKey, result, 5 * 60 * 1000);
    return result;
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

    const { isPeakHour } = require('../utils/peakHours');

    let dateFormat = '';
    if (timeSlotGranularity === 'hour') {
      dateFormat = 'DATE_FORMAT(mh.check_time, "%Y-%m-%d %H:00:00")';
    } else {
      dateFormat = 'DATE_FORMAT(mh.check_time, "%Y-%m-%d")';
    }

    let whereClause = 'WHERE mh.asin_id IS NOT NULL';
    const conditions = [];

    if (country) {
      if (country === 'EU') {
        // EU汇总：包含所有欧洲国家
        whereClause += ` AND mh.country IN ('UK', 'DE', 'FR', 'IT', 'ES')`;
      } else {
        whereClause += ` AND mh.country = ?`;
        conditions.push(country);
      }
    }

    if (startTime) {
      whereClause += ` AND mh.check_time >= ?`;
      conditions.push(startTime);
    }

    if (endTime) {
      whereClause += ` AND mh.check_time <= ?`;
      conditions.push(endTime);
    }

    // 如果需要按站点或品牌筛选，需要关联 asins 表
    let joinClause = '';
    if (site || brand) {
      joinClause = 'LEFT JOIN asins a ON a.id = mh.asin_id';
      if (site) {
        whereClause += ` AND a.site = ?`;
        conditions.push(site);
      }
      if (brand) {
        whereClause += ` AND a.brand = ?`;
        conditions.push(brand);
      }
    }

    // 优化：使用数据库 GROUP BY 聚合，减少内存占用
    // 先按时间槽、国家、站点、品牌、ASIN分组，在数据库层面聚合
    const groupByFields = [];
    const selectFields = [];

    // 构建 GROUP BY 字段
    groupByFields.push(dateFormat);
    groupByFields.push('mh.country');
    if (site) {
      groupByFields.push('a.site');
    }
    if (brand) {
      groupByFields.push('a.brand');
    }
    groupByFields.push('mh.asin_id');

    // 构建 SELECT 字段
    selectFields.push(`${dateFormat} as time_slot`);
    selectFields.push('mh.country');
    if (site) {
      selectFields.push('a.site as site');
    } else {
      selectFields.push("'' as site");
    }
    if (brand) {
      selectFields.push('a.brand as brand');
    } else {
      selectFields.push("'' as brand");
    }
    selectFields.push('mh.asin_id');
    selectFields.push('COUNT(*) as check_count');
    selectFields.push(
      'SUM(CASE WHEN mh.is_broken = 1 THEN 1 ELSE 0 END) as broken_count',
    );
    selectFields.push('MAX(mh.is_broken) as has_broken');
    selectFields.push('MIN(mh.check_time) as first_check_time');

    // 优化：使用数据库聚合查询（获取所有聚合数据，然后在内存中分组和分页）
    const sql = `
      SELECT 
        ${selectFields.join(', ')}
      FROM monitor_history mh
      ${joinClause}
      ${whereClause}
      GROUP BY ${groupByFields.join(', ')}
      ORDER BY first_check_time ASC, mh.country ASC
      ${site ? ', a.site ASC' : ''}
      ${brand ? ', a.brand ASC' : ''}
    `;

    const groupedRecords = await query(sql, conditions);

    // 按维度分组统计（国家、站点、品牌、时间槽）
    const groupKey = site || brand ? (site ? 'site' : 'brand') : 'country';
    const statsMap = new Map(); // key: groupValue_timeSlot, value: stats

    // 在内存中计算指标（数据量已大大减少）
    groupedRecords.forEach((record) => {
      const groupValue = record[groupKey] || record.country || 'ALL';
      const timeSlot = record.time_slot;
      const key = `${groupValue}_${timeSlot}`;

      if (!statsMap.has(key)) {
        statsMap.set(key, {
          groupValue,
          timeSlot,
          country: record.country,
          site: record.site || '',
          brand: record.brand || '',
          totalChecks: 0,
          brokenCount: 0,
          peakBroken: 0,
          peakTotal: 0,
          lowBroken: 0,
          lowTotal: 0,
          dedupMap: new Map(), // key: country_asin_timeSlot
        });
      }

      const stats = statsMap.get(key);
      const checkCount = Number(record.check_count) || 0;
      const brokenCountInGroup = Number(record.broken_count) || 0;
      const hasBroken = record.has_broken === 1;

      stats.totalChecks += checkCount;
      stats.brokenCount += brokenCountInGroup;

      // 判断是否在高峰时段（使用该组的第一个检查时间）
      const checkTime = new Date(record.first_check_time);
      const isPeak = isPeakHour(checkTime, record.country);
      if (isPeak) {
        stats.peakTotal += checkCount;
        stats.peakBroken += brokenCountInGroup;
      } else {
        stats.lowTotal += checkCount;
        stats.lowBroken += brokenCountInGroup;
      }

      // 去重统计：按 (国家 + ASIN + 时间槽) 去重
      const dedupKey = `${record.country}_${record.asin_id}_${timeSlot}`;
      if (!stats.dedupMap.has(dedupKey)) {
        stats.dedupMap.set(dedupKey, { isBroken: false });
      }
      // 如果该ASIN在该时间槽内任意一次快照为异常，则计为异常
      if (hasBroken) {
        stats.dedupMap.get(dedupKey).isBroken = true;
      }
    });

    // 计算每个分组的指标
    const result = [];
    statsMap.forEach((stats) => {
      const totalAsinsDedup = stats.dedupMap.size;
      let brokenAsinsDedup = 0;
      stats.dedupMap.forEach((value) => {
        if (value.isBroken) {
          brokenAsinsDedup++;
        }
      });

      const ratioAllAsin =
        stats.totalChecks > 0
          ? (stats.brokenCount / stats.totalChecks) * 100
          : 0;
      const ratioAllTime =
        totalAsinsDedup > 0 ? (brokenAsinsDedup / totalAsinsDedup) * 100 : 0;
      const globalPeakRate =
        stats.totalChecks > 0
          ? (stats.peakBroken / stats.totalChecks) * 100
          : 0;
      const globalLowRate =
        stats.totalChecks > 0 ? (stats.lowBroken / stats.totalChecks) * 100 : 0;
      const ratioHigh =
        stats.peakTotal > 0 ? (stats.peakBroken / stats.peakTotal) * 100 : 0;
      const ratioLow =
        stats.lowTotal > 0 ? (stats.lowBroken / stats.lowTotal) * 100 : 0;

      result.push({
        timeSlot: stats.timeSlot,
        country: stats.country,
        site: stats.site,
        brand: stats.brand,
        totalChecks: stats.totalChecks,
        ratioAllAsin,
        ratioAllTime,
        globalPeakRate,
        globalLowRate,
        ratioHigh,
        ratioLow,
        brokenCount: stats.brokenCount,
        totalAsinsDedup,
        brokenAsinsDedup,
        peakBroken: stats.peakBroken,
        peakTotal: stats.peakTotal,
        lowBroken: stats.lowBroken,
        lowTotal: stats.lowTotal,
      });
    });

    // 排序和分页
    result.sort((a, b) => {
      if (a.timeSlot !== b.timeSlot) {
        return a.timeSlot.localeCompare(b.timeSlot);
      }
      if (a.country !== b.country) {
        return a.country.localeCompare(b.country);
      }
      if (a.site !== b.site) {
        return a.site.localeCompare(b.site);
      }
      return a.brand.localeCompare(b.brand);
    });

    const total = result.length;
    const offset = (Number(current) - 1) * Number(pageSize);
    const limit = Number(pageSize);
    const paginatedResult = result.slice(offset, offset + limit);

    return {
      list: paginatedResult,
      total,
      current: Number(current),
      pageSize: Number(pageSize),
    };
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
    let total = cacheService.get(countKey);
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
      cacheService.set(countKey, total, 60 * 1000);
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
    let total = cacheService.get(countKey);

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
      cacheService.set(countKey, total, 60 * 1000);
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
