const VariantGroup = require('../models/VariantGroup');
const ASIN = require('../models/ASIN');
const MonitorHistory = require('../models/MonitorHistory');
const { query } = require('../config/database');

/**
 * 获取仪表盘数据
 */
exports.getDashboardData = async (req, res) => {
  try {
    console.log('[getDashboardData] 开始获取仪表盘数据', {
      userId: req.userId,
    });

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
