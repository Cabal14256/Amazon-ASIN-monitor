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

// 高峰期统计
exports.getPeakHoursStatistics = async (req, res) => {
  try {
    const { country, startTime, endTime } = req.query;

    if (!country) {
      return res.status(400).json({
        success: false,
        errorMessage: '高峰期统计需要指定国家',
        errorCode: 400,
      });
    }

    const statistics = await MonitorHistory.getPeakHoursStatistics({
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
    console.error('高峰期统计错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '查询失败',
      errorCode: 500,
    });
  }
};

// 手动触发监控检查
exports.triggerManualCheck = async (req, res) => {
  try {
    const { countries } = req.body; // 可选：指定要检查的国家数组

    const { triggerManualCheck } = require('../services/monitorTaskRunner');

    console.log(
      `[手动检查] 收到手动检查请求，国家: ${
        countries ? countries.join(', ') : '全部'
      }`,
    );

    const result = await triggerManualCheck(countries);

    if (result && result.success) {
      res.json({
        success: true,
        data: {
          message: '检查完成',
          totalChecked: result.totalChecked,
          totalBroken: result.totalBroken,
          totalNormal: result.totalNormal,
          duration: result.duration,
          checkTime: result.checkTime,
          countryResults: result.countryResults,
          notifyResults: result.notifyResults,
        },
        errorCode: 0,
      });
    } else {
      res.status(500).json({
        success: false,
        errorMessage: (result && result.error) || '检查失败',
        errorCode: 500,
        data: {
          totalChecked: (result && result.totalChecked) || 0,
          totalBroken: (result && result.totalBroken) || 0,
          totalNormal: (result && result.totalNormal) || 0,
        },
      });
    }
  } catch (error) {
    console.error('手动触发监控检查错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '检查失败',
      errorCode: 500,
    });
  }
};
