const CompetitorMonitorHistory = require('../models/CompetitorMonitorHistory');

// 查询监控历史列表
exports.getCompetitorMonitorHistory = async (req, res) => {
  try {
    const {
      variantGroupId,
      asinId,
      asin,
      country,
      checkType,
      isBroken,
      startTime,
      endTime,
      current,
      pageSize,
    } = req.query;

    const result = await CompetitorMonitorHistory.findAll({
      variantGroupId,
      asinId,
      asin,
      country,
      checkType,
      isBroken,
      startTime,
      endTime,
      current: current || 1,
      pageSize: pageSize || 10,
    });

    res.json({
      success: true,
      data: result,
      errorCode: 0,
    });
  } catch (error) {
    console.error('查询监控历史错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '查询失败',
      errorCode: 500,
    });
  }
};

// 获取监控历史详情
exports.getCompetitorMonitorHistoryById = async (req, res) => {
  try {
    const { id } = req.params;
    const history = await CompetitorMonitorHistory.findById(id);
    if (!history) {
      return res.status(404).json({
        success: false,
        errorMessage: '竞品监控历史不存在',
        errorCode: 404,
      });
    }
    res.json({
      success: true,
      data: history,
      errorCode: 0,
    });
  } catch (error) {
    console.error('查询监控历史详情错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '查询失败',
      errorCode: 500,
    });
  }
};

// 竞品监控不包含数据分析功能，已移除所有统计相关方法
