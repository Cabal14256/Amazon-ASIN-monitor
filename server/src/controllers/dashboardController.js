const VariantGroup = require('../models/VariantGroup');
const ASIN = require('../models/ASIN');
const MonitorHistory = require('../models/MonitorHistory');
const { query } = require('../config/database');

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
    console.log('[getDashboardData] 开始获取仪表盘数据', {
      userId: req.userId,
    });

    if (dashboardCache.expiresAt > Date.now() && dashboardCache.data) {
      console.log('[getDashboardData] 使用缓存数据');
      return res.json({
        success: true,
        data: dashboardCache.data,
        errorCode: 0,
      });
    }

    // 1. 关键指标概览
    // 总变体组数
    const [totalGroupsResult] = await query(
      'SELECT COUNT(*) as total FROM variant_groups',
    );
    const totalGroups = totalGroupsResult?.total || 0;
    console.log('[getDashboardData] 总变体组数:', totalGroups);

    // 总ASIN数
    const [totalASINsResult] = await query(
      'SELECT COUNT(*) as total FROM asins',
    );
    const totalASINs = totalASINsResult?.total || 0;

    // 异常变体组数
    const [brokenGroupsResult] = await query(
      'SELECT COUNT(*) as total FROM variant_groups WHERE is_broken = 1',
    );
    const brokenGroups = brokenGroupsResult?.total || 0;

    // 异常ASIN数
    const [brokenASINsResult] = await query(
      'SELECT COUNT(*) as total FROM asins WHERE is_broken = 1',
    );
    const brokenASINs = brokenASINsResult?.total || 0;

    // 今日检查次数（从今天0点开始）
    // 使用本地时间格式化，避免时区问题
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const todayStartStr = `${year}-${month}-${day} 00:00:00`;

    console.log('[getDashboardData] 今日开始时间:', todayStartStr);

    const [todayChecksResult] = await query(
      'SELECT COUNT(*) as total FROM monitor_history WHERE check_time >= ?',
      [todayStartStr],
    );
    const todayChecks = todayChecksResult?.total || 0;

    // 今日异常次数
    const [todayBrokenResult] = await query(
      'SELECT COUNT(*) as total FROM monitor_history WHERE check_time >= ? AND is_broken = 1',
      [todayStartStr],
    );
    const todayBroken = todayBrokenResult?.total || 0;

    // 2. 实时异常监控面板
    // 异常变体组列表（最多10个）
    const brokenGroupsList = await query(
      `SELECT id, name, country, site, brand, variant_status, update_time 
       FROM variant_groups 
       WHERE is_broken = 1 
       ORDER BY update_time DESC 
       LIMIT 10`,
    );

    // 异常ASIN列表（最多10个）
    const brokenASINsList = await query(
      `SELECT a.id, a.asin, a.name, a.country, a.site, a.brand, a.variant_status, 
              a.update_time, vg.name as variant_group_name 
       FROM asins a
       LEFT JOIN variant_groups vg ON vg.id = a.variant_group_id
       WHERE a.is_broken = 1 
       ORDER BY a.update_time DESC 
       LIMIT 10`,
    );

    // 3. 监控状态分布
    // 按国家分布
    const countryDistribution = await query(
      `SELECT 
        country,
        COUNT(*) as total,
        SUM(CASE WHEN is_broken = 1 THEN 1 ELSE 0 END) as broken,
        SUM(CASE WHEN is_broken = 0 THEN 1 ELSE 0 END) as normal
       FROM variant_groups
       GROUP BY country
       ORDER BY country`,
    );

    // 4. 最近监控活动时间线（最近20条）
    const recentActivities = await query(
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
    );

    // 5. 按国家分组的统计数据
    // 欧洲五国列表
    const euCountries = ['UK', 'DE', 'FR', 'IT', 'ES'];

    // 按国家统计总变体组数
    const groupsByCountry = await query(
      `SELECT country, COUNT(*) as total 
       FROM variant_groups 
       GROUP BY country`,
    );

    // 按国家统计总ASIN数
    const asinsByCountry = await query(
      `SELECT country, COUNT(*) as total 
       FROM asins 
       GROUP BY country`,
    );

    // 按国家统计异常变体组数
    const brokenGroupsByCountry = await query(
      `SELECT country, COUNT(*) as total 
       FROM variant_groups 
       WHERE is_broken = 1 
       GROUP BY country`,
    );

    // 按国家统计异常ASIN数
    const brokenASINsByCountry = await query(
      `SELECT country, COUNT(*) as total 
       FROM asins 
       WHERE is_broken = 1 
       GROUP BY country`,
    );

    // 按国家统计今日检查次数
    const todayChecksByCountry = await query(
      `SELECT country, COUNT(*) as total 
       FROM monitor_history 
       WHERE check_time >= ? 
       GROUP BY country`,
      [todayStartStr],
    );

    // 按国家统计今日异常次数
    const todayBrokenByCountry = await query(
      `SELECT country, COUNT(*) as total 
       FROM monitor_history 
       WHERE check_time >= ? AND is_broken = 1 
       GROUP BY country`,
      [todayStartStr],
    );

    // 将查询结果转换为对象，方便查找
    const getCountryValue = (data, country, defaultValue = 0) => {
      const item = data.find((d) => d.country === country);
      return item ? item.total || 0 : defaultValue;
    };

    // 计算欧洲五国总和
    const calculateEUTotal = (data) => {
      return euCountries.reduce((sum, country) => {
        return sum + getCountryValue(data, country, 0);
      }, 0);
    };

    // 构建按国家分组的数据结构
    const overviewByCountry = {
      US: {
        totalGroups: getCountryValue(groupsByCountry, 'US', 0),
        totalASINs: getCountryValue(asinsByCountry, 'US', 0),
        brokenGroups: getCountryValue(brokenGroupsByCountry, 'US', 0),
        brokenASINs: getCountryValue(brokenASINsByCountry, 'US', 0),
        todayChecks: getCountryValue(todayChecksByCountry, 'US', 0),
        todayBroken: getCountryValue(todayBrokenByCountry, 'US', 0),
        normalGroups:
          getCountryValue(groupsByCountry, 'US', 0) -
          getCountryValue(brokenGroupsByCountry, 'US', 0),
        normalASINs:
          getCountryValue(asinsByCountry, 'US', 0) -
          getCountryValue(brokenASINsByCountry, 'US', 0),
      },
      UK: {
        totalGroups: getCountryValue(groupsByCountry, 'UK', 0),
        totalASINs: getCountryValue(asinsByCountry, 'UK', 0),
        brokenGroups: getCountryValue(brokenGroupsByCountry, 'UK', 0),
        brokenASINs: getCountryValue(brokenASINsByCountry, 'UK', 0),
        todayChecks: getCountryValue(todayChecksByCountry, 'UK', 0),
        todayBroken: getCountryValue(todayBrokenByCountry, 'UK', 0),
        normalGroups:
          getCountryValue(groupsByCountry, 'UK', 0) -
          getCountryValue(brokenGroupsByCountry, 'UK', 0),
        normalASINs:
          getCountryValue(asinsByCountry, 'UK', 0) -
          getCountryValue(brokenASINsByCountry, 'UK', 0),
      },
      DE: {
        totalGroups: getCountryValue(groupsByCountry, 'DE', 0),
        totalASINs: getCountryValue(asinsByCountry, 'DE', 0),
        brokenGroups: getCountryValue(brokenGroupsByCountry, 'DE', 0),
        brokenASINs: getCountryValue(brokenASINsByCountry, 'DE', 0),
        todayChecks: getCountryValue(todayChecksByCountry, 'DE', 0),
        todayBroken: getCountryValue(todayBrokenByCountry, 'DE', 0),
        normalGroups:
          getCountryValue(groupsByCountry, 'DE', 0) -
          getCountryValue(brokenGroupsByCountry, 'DE', 0),
        normalASINs:
          getCountryValue(asinsByCountry, 'DE', 0) -
          getCountryValue(brokenASINsByCountry, 'DE', 0),
      },
      FR: {
        totalGroups: getCountryValue(groupsByCountry, 'FR', 0),
        totalASINs: getCountryValue(asinsByCountry, 'FR', 0),
        brokenGroups: getCountryValue(brokenGroupsByCountry, 'FR', 0),
        brokenASINs: getCountryValue(brokenASINsByCountry, 'FR', 0),
        todayChecks: getCountryValue(todayChecksByCountry, 'FR', 0),
        todayBroken: getCountryValue(todayBrokenByCountry, 'FR', 0),
        normalGroups:
          getCountryValue(groupsByCountry, 'FR', 0) -
          getCountryValue(brokenGroupsByCountry, 'FR', 0),
        normalASINs:
          getCountryValue(asinsByCountry, 'FR', 0) -
          getCountryValue(brokenASINsByCountry, 'FR', 0),
      },
      IT: {
        totalGroups: getCountryValue(groupsByCountry, 'IT', 0),
        totalASINs: getCountryValue(asinsByCountry, 'IT', 0),
        brokenGroups: getCountryValue(brokenGroupsByCountry, 'IT', 0),
        brokenASINs: getCountryValue(brokenASINsByCountry, 'IT', 0),
        todayChecks: getCountryValue(todayChecksByCountry, 'IT', 0),
        todayBroken: getCountryValue(todayBrokenByCountry, 'IT', 0),
        normalGroups:
          getCountryValue(groupsByCountry, 'IT', 0) -
          getCountryValue(brokenGroupsByCountry, 'IT', 0),
        normalASINs:
          getCountryValue(asinsByCountry, 'IT', 0) -
          getCountryValue(brokenASINsByCountry, 'IT', 0),
      },
      ES: {
        totalGroups: getCountryValue(groupsByCountry, 'ES', 0),
        totalASINs: getCountryValue(asinsByCountry, 'ES', 0),
        brokenGroups: getCountryValue(brokenGroupsByCountry, 'ES', 0),
        brokenASINs: getCountryValue(brokenASINsByCountry, 'ES', 0),
        todayChecks: getCountryValue(todayChecksByCountry, 'ES', 0),
        todayBroken: getCountryValue(todayBrokenByCountry, 'ES', 0),
        normalGroups:
          getCountryValue(groupsByCountry, 'ES', 0) -
          getCountryValue(brokenGroupsByCountry, 'ES', 0),
        normalASINs:
          getCountryValue(asinsByCountry, 'ES', 0) -
          getCountryValue(brokenASINsByCountry, 'ES', 0),
      },
      EU_TOTAL: {
        totalGroups: calculateEUTotal(groupsByCountry),
        totalASINs: calculateEUTotal(asinsByCountry),
        brokenGroups: calculateEUTotal(brokenGroupsByCountry),
        brokenASINs: calculateEUTotal(brokenASINsByCountry),
        todayChecks: calculateEUTotal(todayChecksByCountry),
        todayBroken: calculateEUTotal(todayBrokenByCountry),
        normalGroups:
          calculateEUTotal(groupsByCountry) -
          calculateEUTotal(brokenGroupsByCountry),
        normalASINs:
          calculateEUTotal(asinsByCountry) -
          calculateEUTotal(brokenASINsByCountry),
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

    console.log('[getDashboardData] 数据获取成功', {
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
    console.error('[getDashboardData] 获取仪表盘数据错误:', error);
    console.error('[getDashboardData] 错误堆栈:', error.stack);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '获取仪表盘数据失败',
      errorCode: 500,
    });
  }
};
