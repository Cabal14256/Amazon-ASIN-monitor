const MonitorHistory = require('../models/MonitorHistory');

// 查询监控历史列表
exports.getMonitorHistory = async (req, res) => {
  try {
    const {
      variantGroupId,
      asinId,
      country,
      checkType,
      isBroken,
      startTime,
      endTime,
      current,
      pageSize,
    } = req.query;

    const result = await MonitorHistory.findAll({
      variantGroupId,
      asinId,
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
exports.getMonitorHistoryById = async (req, res) => {
  try {
    const { id } = req.params;
    const history = await MonitorHistory.findById(id);
    if (!history) {
      return res.status(404).json({
        success: false,
        errorMessage: '监控历史不存在',
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

// 获取统计信息
exports.getStatistics = async (req, res) => {
  try {
    const { variantGroupId, asinId, country, startTime, endTime } = req.query;
    const statistics = await MonitorHistory.getStatistics({
      variantGroupId,
      asinId,
      country,
      startTime,
      endTime,
    });

    res.json({
      success: true,
      data: statistics,
      errorCode: 0,
    });
  } catch (error) {
    console.error('获取统计信息错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '查询失败',
      errorCode: 500,
    });
  }
};

// 按时间分组统计
exports.getStatisticsByTime = async (req, res) => {
  try {
    const { country, startTime, endTime, groupBy = 'day' } = req.query;
    const statistics = await MonitorHistory.getStatisticsByTime({
      country,
      startTime,
      endTime,
      groupBy,
    });

    res.json({
      success: true,
      data: statistics,
      errorCode: 0,
    });
  } catch (error) {
    console.error('按时间统计错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '查询失败',
      errorCode: 500,
    });
  }
};

// 按国家分组统计
exports.getStatisticsByCountry = async (req, res) => {
  try {
    const { startTime, endTime } = req.query;
    const statistics = await MonitorHistory.getStatisticsByCountry({
      startTime,
      endTime,
    });

    res.json({
      success: true,
      data: statistics,
      errorCode: 0,
    });
  } catch (error) {
    console.error('按国家统计错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '查询失败',
      errorCode: 500,
    });
  }
};

// 按变体组分组统计
exports.getStatisticsByVariantGroup = async (req, res) => {
  try {
    const { country, startTime, endTime, limit = 10 } = req.query;
    const statistics = await MonitorHistory.getStatisticsByVariantGroup({
      country,
      startTime,
      endTime,
      limit,
    });

    res.json({
      success: true,
      data: statistics,
      errorCode: 0,
    });
  } catch (error) {
    console.error('按变体组统计错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '查询失败',
      errorCode: 500,
    });
  }
};
