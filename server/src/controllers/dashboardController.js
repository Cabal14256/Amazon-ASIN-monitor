const { query } = require('../config/database');
const logger = require('../utils/logger');

const DASHBOARD_TTL_MS = 30 * 1000;
let dashboardCache = {
  data: null,
  expiresAt: 0,
};

/**
 * 获取仪表盘数据
 */
exports.getDashboardData = async (req, res) => {
  try {
    logger.debug('[getDashboardData] 开始获取仪表盘数据', {
      userId: req.userId,
    });

    if (dashboardCache.expiresAt > Date.now() && dashboardCache.data) {
      logger.debug('[getDashboardData] 使用缓存数据');
      return res.json({
        success: true,
        data: dashboardCache.data,
        errorCode: 0,
      });
    }

    // 今日检查次数（从今天0点开始）
    // 使用本地时间格式化，避免时区问题
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const todayStartStr = `${year}-${month}-${day} 00:00:00`;

    logger.debug('[getDashboardData] 今日开始时间:', todayStartStr);

    const [
      overviewResult,
      brokenGroupsList,
      brokenASINsList,
      recentActivitiesRaw,
      groupsByCountry,
      asinsByCountry,
      todayByCountry,
    ] = await Promise.all([
      query(
        `SELECT
          (SELECT COUNT(*) FROM variant_groups) as totalGroups,
          (SELECT COUNT(*) FROM asins) as totalASINs,
          (SELECT COUNT(*) FROM variant_groups WHERE is_broken = 1) as brokenGroups,
          (SELECT COUNT(*) FROM asins WHERE is_broken = 1) as brokenASINs,
          (SELECT COUNT(*) FROM monitor_history WHERE check_time >= ?) as todayChecks,
          (SELECT COUNT(*) FROM monitor_history WHERE check_time >= ? AND is_broken = 1) as todayBroken`,
        [todayStartStr, todayStartStr],
      ),
      query(
        `SELECT id, name, country, site, brand, variant_status, update_time 
         FROM variant_groups 
         WHERE is_broken = 1 
         ORDER BY update_time DESC 
         LIMIT 10`,
      ),
      query(
        `SELECT a.id, a.asin, a.name, a.country, a.site, a.brand, a.variant_status, 
                a.update_time, vg.name as variant_group_name 
         FROM asins a
         LEFT JOIN variant_groups vg ON vg.id = a.variant_group_id
         WHERE a.is_broken = 1 
         ORDER BY a.update_time DESC 
         LIMIT 10`,
      ),
      query(
        `SELECT 
          mh.*,
          vg.name as variant_group_name,
          a.asin,
          a.name as asin_name
         FROM monitor_history mh
         LEFT JOIN variant_groups vg ON vg.id = mh.variant_group_id
         LEFT JOIN asins a ON a.id = mh.asin_id
         ORDER BY mh.check_time DESC
         LIMIT 20`,
      ),
      query(
        `SELECT 
          country,
          COUNT(*) as total,
          SUM(CASE WHEN is_broken = 1 THEN 1 ELSE 0 END) as broken
         FROM variant_groups
         GROUP BY country
         ORDER BY country`,
      ),
      query(
        `SELECT 
          country,
          COUNT(*) as total,
          SUM(CASE WHEN is_broken = 1 THEN 1 ELSE 0 END) as broken
         FROM asins
         GROUP BY country`,
      ),
      query(
        `SELECT 
          country,
          COUNT(*) as total,
          SUM(CASE WHEN is_broken = 1 THEN 1 ELSE 0 END) as broken
         FROM monitor_history 
         WHERE check_time >= ? 
         GROUP BY country`,
        [todayStartStr],
      ),
    ]);

    const overviewRow = overviewResult?.[0] || {};
    const totalGroups = overviewRow.totalGroups || 0;
    const totalASINs = overviewRow.totalASINs || 0;
    const brokenGroups = overviewRow.brokenGroups || 0;
    const brokenASINs = overviewRow.brokenASINs || 0;
    const todayChecks = overviewRow.todayChecks || 0;
    const todayBroken = overviewRow.todayBroken || 0;
    logger.debug('[getDashboardData] 总变体组数:', totalGroups);

    const countryDistribution = groupsByCountry.map((item) => ({
      country: item.country,
      total: item.total || 0,
      broken: item.broken || 0,
      normal: (item.total || 0) - (item.broken || 0),
    }));
    const recentActivities = recentActivitiesRaw.map((item) => ({
      ...item,
      checkTime: item.check_time,
      checkType: item.check_type,
      isBroken: item.is_broken,
      notificationSent: item.notification_sent,
      variantGroupName: item.variant_group_name,
      asinName: item.asin_name,
      createTime: item.create_time,
    }));

    // 5. 按国家分组的统计数据
    // 欧洲五国列表
    const euCountries = ['UK', 'DE', 'FR', 'IT', 'ES'];

    // 将查询结果转换为对象，方便查找
    const getCountryValue = (data, country, key = 'total', defaultValue = 0) => {
      const item = data.find((d) => d.country === country);
      if (!item) {
        return defaultValue;
      }
      const raw = item[key];
      return Number.isFinite(Number(raw)) ? Number(raw) : defaultValue;
    };

    // 计算欧洲五国总和
    const calculateEUTotal = (data, key = 'total') => {
      return euCountries.reduce((sum, country) => {
        return sum + getCountryValue(data, country, key, 0);
      }, 0);
    };

    // 构建按国家分组的数据结构
    const overviewByCountry = {
      US: {
        totalGroups: getCountryValue(groupsByCountry, 'US'),
        totalASINs: getCountryValue(asinsByCountry, 'US'),
        brokenGroups: getCountryValue(groupsByCountry, 'US', 'broken'),
        brokenASINs: getCountryValue(asinsByCountry, 'US', 'broken'),
        todayChecks: getCountryValue(todayByCountry, 'US'),
        todayBroken: getCountryValue(todayByCountry, 'US', 'broken'),
        normalGroups:
          getCountryValue(groupsByCountry, 'US') -
          getCountryValue(groupsByCountry, 'US', 'broken'),
        normalASINs:
          getCountryValue(asinsByCountry, 'US') -
          getCountryValue(asinsByCountry, 'US', 'broken'),
      },
      UK: {
        totalGroups: getCountryValue(groupsByCountry, 'UK'),
        totalASINs: getCountryValue(asinsByCountry, 'UK'),
        brokenGroups: getCountryValue(groupsByCountry, 'UK', 'broken'),
        brokenASINs: getCountryValue(asinsByCountry, 'UK', 'broken'),
        todayChecks: getCountryValue(todayByCountry, 'UK'),
        todayBroken: getCountryValue(todayByCountry, 'UK', 'broken'),
        normalGroups:
          getCountryValue(groupsByCountry, 'UK') -
          getCountryValue(groupsByCountry, 'UK', 'broken'),
        normalASINs:
          getCountryValue(asinsByCountry, 'UK') -
          getCountryValue(asinsByCountry, 'UK', 'broken'),
      },
      DE: {
        totalGroups: getCountryValue(groupsByCountry, 'DE'),
        totalASINs: getCountryValue(asinsByCountry, 'DE'),
        brokenGroups: getCountryValue(groupsByCountry, 'DE', 'broken'),
        brokenASINs: getCountryValue(asinsByCountry, 'DE', 'broken'),
        todayChecks: getCountryValue(todayByCountry, 'DE'),
        todayBroken: getCountryValue(todayByCountry, 'DE', 'broken'),
        normalGroups:
          getCountryValue(groupsByCountry, 'DE') -
          getCountryValue(groupsByCountry, 'DE', 'broken'),
        normalASINs:
          getCountryValue(asinsByCountry, 'DE') -
          getCountryValue(asinsByCountry, 'DE', 'broken'),
      },
      FR: {
        totalGroups: getCountryValue(groupsByCountry, 'FR'),
        totalASINs: getCountryValue(asinsByCountry, 'FR'),
        brokenGroups: getCountryValue(groupsByCountry, 'FR', 'broken'),
        brokenASINs: getCountryValue(asinsByCountry, 'FR', 'broken'),
        todayChecks: getCountryValue(todayByCountry, 'FR'),
        todayBroken: getCountryValue(todayByCountry, 'FR', 'broken'),
        normalGroups:
          getCountryValue(groupsByCountry, 'FR') -
          getCountryValue(groupsByCountry, 'FR', 'broken'),
        normalASINs:
          getCountryValue(asinsByCountry, 'FR') -
          getCountryValue(asinsByCountry, 'FR', 'broken'),
      },
      IT: {
        totalGroups: getCountryValue(groupsByCountry, 'IT'),
        totalASINs: getCountryValue(asinsByCountry, 'IT'),
        brokenGroups: getCountryValue(groupsByCountry, 'IT', 'broken'),
        brokenASINs: getCountryValue(asinsByCountry, 'IT', 'broken'),
        todayChecks: getCountryValue(todayByCountry, 'IT'),
        todayBroken: getCountryValue(todayByCountry, 'IT', 'broken'),
        normalGroups:
          getCountryValue(groupsByCountry, 'IT') -
          getCountryValue(groupsByCountry, 'IT', 'broken'),
        normalASINs:
          getCountryValue(asinsByCountry, 'IT') -
          getCountryValue(asinsByCountry, 'IT', 'broken'),
      },
      ES: {
        totalGroups: getCountryValue(groupsByCountry, 'ES'),
        totalASINs: getCountryValue(asinsByCountry, 'ES'),
        brokenGroups: getCountryValue(groupsByCountry, 'ES', 'broken'),
        brokenASINs: getCountryValue(asinsByCountry, 'ES', 'broken'),
        todayChecks: getCountryValue(todayByCountry, 'ES'),
        todayBroken: getCountryValue(todayByCountry, 'ES', 'broken'),
        normalGroups:
          getCountryValue(groupsByCountry, 'ES') -
          getCountryValue(groupsByCountry, 'ES', 'broken'),
        normalASINs:
          getCountryValue(asinsByCountry, 'ES') -
          getCountryValue(asinsByCountry, 'ES', 'broken'),
      },
      EU_TOTAL: {
        totalGroups: calculateEUTotal(groupsByCountry),
        totalASINs: calculateEUTotal(asinsByCountry),
        brokenGroups: calculateEUTotal(groupsByCountry, 'broken'),
        brokenASINs: calculateEUTotal(asinsByCountry, 'broken'),
        todayChecks: calculateEUTotal(todayByCountry),
        todayBroken: calculateEUTotal(todayByCountry, 'broken'),
        normalGroups:
          calculateEUTotal(groupsByCountry) -
          calculateEUTotal(groupsByCountry, 'broken'),
        normalASINs:
          calculateEUTotal(asinsByCountry) -
          calculateEUTotal(asinsByCountry, 'broken'),
      },
    };

    const dashboardData = {
      // 关键指标
      overview: {
        totalGroups,
        totalASINs,
        brokenGroups,
        brokenASINs,
        todayChecks,
        todayBroken,
        normalGroups: totalGroups - brokenGroups,
        normalASINs: totalASINs - brokenASINs,
        overviewByCountry,
      },
      // 实时异常
      realtimeAlerts: {
        brokenGroups: brokenGroupsList,
        brokenASINs: brokenASINsList,
      },
      // 状态分布
      distribution: {
        byCountry: countryDistribution,
      },
      // 最近活动
      recentActivities,
    };

    logger.debug('[getDashboardData] 数据获取成功', {
      totalGroups,
      totalASINs,
      brokenGroups,
      brokenASINs,
      brokenGroupsListLength: brokenGroupsList.length,
      brokenASINsListLength: brokenASINsList.length,
      countryDistributionLength: countryDistribution.length,
      recentActivitiesLength: recentActivities.length,
    });

    dashboardCache = {
      data: dashboardData,
      expiresAt: Date.now() + DASHBOARD_TTL_MS,
    };

    res.json({
      success: true,
      data: dashboardData,
      errorCode: 0,
    });
  } catch (error) {
    logger.error('[getDashboardData] 获取仪表盘数据错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '获取仪表盘数据失败',
      errorCode: 500,
    });
  }
};
