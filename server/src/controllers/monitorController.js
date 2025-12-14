const MonitorHistory = require('../models/MonitorHistory');
const logger = require('../utils/logger');

/**
 * 重试辅助函数
 * @param {Function} fn - 要执行的异步函数
 * @param {number} maxRetries - 最大重试次数
 * @param {number} delay - 初始延迟时间（毫秒）
 * @returns {Promise} 执行结果
 */
async function withRetry(fn, maxRetries = 3, delay = 1000) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const startTime = Date.now();
      const result = await fn();
      const duration = Date.now() - startTime;
      if (i > 0) {
        logger.info(`[重试成功] 第${i}次重试成功，耗时${duration}ms`);
      }
      return result;
    } catch (error) {
      lastError = error;
      const errorCode = error.code || '';
      const errorMessage = error.message || '';

      // 判断是否应该重试
      const shouldRetry =
        i < maxRetries - 1 &&
        (errorCode === 'ETIMEDOUT' ||
          errorCode === 'PROTOCOL_CONNECTION_LOST' ||
          errorCode === 'ECONNRESET' ||
          errorMessage.includes('timeout') ||
          errorMessage.includes('Connection lost') ||
          errorMessage.includes('Lock wait timeout'));

      if (shouldRetry) {
        const retryDelay = delay * (i + 1); // 指数退避
        logger.warn(
          `[重试] 第${
            i + 1
          }次尝试失败: ${errorMessage}，${retryDelay}ms后重试 (${
            i + 1
          }/${maxRetries})`,
        );
        await new Promise((resolve) => {
          setTimeout(resolve, retryDelay);
        });
        continue;
      }

      // 不应该重试或已达到最大重试次数
      if (i > 0) {
        logger.error(`[重试失败] 已重试${i}次，最终失败: ${errorMessage}`);
      }
      throw error;
    }
  }
  throw lastError;
}

// 查询监控历史列表
exports.getMonitorHistory = async (req, res) => {
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

    const result = await MonitorHistory.findAll({
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
  const startTime = Date.now();
  try {
    const {
      country,
      startTime: startTimeParam,
      endTime,
      groupBy = 'day',
    } = req.query;

    const statistics = await withRetry(
      async () => {
        return await MonitorHistory.getStatisticsByTime({
          country,
          startTime: startTimeParam,
          endTime,
          groupBy,
        });
      },
      3,
      1000,
    );

    const duration = Date.now() - startTime;
    logger.info(`[统计查询] getStatisticsByTime 完成，耗时${duration}ms`);

    res.json({
      success: true,
      data: statistics,
      errorCode: 0,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(
      `[统计查询] getStatisticsByTime 失败，耗时${duration}ms:`,
      error,
    );
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
  const startTime = Date.now();
  try {
    const { country, startTime: startTimeParam, endTime } = req.query;

    if (!country) {
      return res.status(400).json({
        success: false,
        errorMessage: '高峰期统计需要指定国家',
        errorCode: 400,
      });
    }

    const statistics = await withRetry(
      async () => {
        return await MonitorHistory.getPeakHoursStatistics({
          country,
          startTime: startTimeParam,
          endTime,
        });
      },
      3,
      1000,
    );

    const duration = Date.now() - startTime;
    logger.info(`[统计查询] getPeakHoursStatistics 完成，耗时${duration}ms`);

    res.json({
      success: true,
      data: statistics,
      errorCode: 0,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(
      `[统计查询] getPeakHoursStatistics 失败，耗时${duration}ms:`,
      error,
    );
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

// 全部国家汇总统计
exports.getAllCountriesSummary = async (req, res) => {
  const startTime = Date.now();
  try {
    const {
      startTime: startTimeParam,
      endTime,
      timeSlotGranularity = 'day',
    } = req.query;

    const statistics = await withRetry(
      async () => {
        return await MonitorHistory.getAllCountriesSummary({
          startTime: startTimeParam,
          endTime,
          timeSlotGranularity,
        });
      },
      3,
      2000,
    ); // 最多重试3次，每次间隔2秒

    const duration = Date.now() - startTime;
    logger.info(`[统计查询] getAllCountriesSummary 完成，耗时${duration}ms`);

    res.json({
      success: true,
      data: statistics,
      errorCode: 0,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(
      `[统计查询] getAllCountriesSummary 失败，耗时${duration}ms:`,
      error,
    );
    res.status(500).json({
      success: false,
      errorMessage: error.message || '查询失败',
      errorCode: 500,
    });
  }
};

// 区域汇总统计（美国/欧洲）
exports.getRegionSummary = async (req, res) => {
  const startTime = Date.now();
  try {
    const {
      startTime: startTimeParam,
      endTime,
      timeSlotGranularity = 'day',
    } = req.query;

    logger.info(
      `[统计查询] getRegionSummary 开始，参数: startTime=${startTimeParam}, endTime=${endTime}, timeSlotGranularity=${timeSlotGranularity}`,
    );

    const statistics = await withRetry(
      async () => {
        return await MonitorHistory.getRegionSummary({
          startTime: startTimeParam,
          endTime,
          timeSlotGranularity,
        });
      },
      3,
      2000, // 增加重试间隔到2秒，统计查询可能需要更长时间
    );

    const duration = Date.now() - startTime;
    logger.info(
      `[统计查询] getRegionSummary 完成，耗时${duration}ms，返回${
        Array.isArray(statistics) ? statistics.length : 0
      }条记录`,
    );

    res.json({
      success: true,
      data: statistics,
      errorCode: 0,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorCode = error.code || '';
    const errorMessage = error.message || '查询失败';
    const isTimeout =
      errorCode === 'ETIMEDOUT' ||
      errorCode === 'PROTOCOL_SEQUENCE_TIMEOUT' ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('Timeout') ||
      duration > 100000; // 如果耗时超过100秒，也认为是超时

    if (isTimeout) {
      logger.error(
        `[统计查询] getRegionSummary 超时，耗时${duration}ms，错误码: ${errorCode}, 错误信息: ${errorMessage}`,
      );
      res.status(504).json({
        success: false,
        errorMessage: '查询超时，请尝试缩小时间范围或稍后重试',
        errorCode: 504,
      });
    } else {
      logger.error(
        `[统计查询] getRegionSummary 失败，耗时${duration}ms，错误码: ${errorCode}, 错误信息: ${errorMessage}`,
        error,
      );
      res.status(500).json({
        success: false,
        errorMessage: errorMessage,
        errorCode: 500,
      });
    }
  }
};

// 周期汇总统计
exports.getPeriodSummary = async (req, res) => {
  const startTime = Date.now();
  try {
    const {
      country,
      site,
      brand,
      startTime: startTimeParam,
      endTime,
      timeSlotGranularity = 'day',
      current = 1,
      pageSize = 10,
    } = req.query;

    logger.info(
      `[统计查询] getPeriodSummary 开始，参数: country=${country}, site=${site}, brand=${brand}, startTime=${startTimeParam}, endTime=${endTime}, timeSlotGranularity=${timeSlotGranularity}, current=${current}, pageSize=${pageSize}`,
    );

    const result = await withRetry(
      async () => {
        return await MonitorHistory.getPeriodSummary({
          country,
          site,
          brand,
          startTime: startTimeParam,
          endTime,
          timeSlotGranularity,
          current,
          pageSize,
        });
      },
      3,
      2000, // 增加重试间隔到2秒，统计查询可能需要更长时间
    );

    const duration = Date.now() - startTime;
    logger.info(
      `[统计查询] getPeriodSummary 完成，耗时${duration}ms，返回${
        result?.list?.length || 0
      }条记录，总计${result?.total || 0}条`,
    );

    res.json({
      success: true,
      data: result,
      errorCode: 0,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorCode = error.code || '';
    const errorMessage = error.message || '查询失败';
    const isTimeout =
      errorCode === 'ETIMEDOUT' ||
      errorCode === 'PROTOCOL_SEQUENCE_TIMEOUT' ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('Timeout') ||
      duration > 100000; // 如果耗时超过100秒，也认为是超时

    if (isTimeout) {
      logger.error(
        `[统计查询] getPeriodSummary 超时，耗时${duration}ms，错误码: ${errorCode}, 错误信息: ${errorMessage}`,
      );
      res.status(504).json({
        success: false,
        errorMessage: '查询超时，请尝试缩小时间范围或稍后重试',
        errorCode: 504,
      });
    } else {
      logger.error(
        `[统计查询] getPeriodSummary 失败，耗时${duration}ms，错误码: ${errorCode}, 错误信息: ${errorMessage}`,
        error,
      );
      res.status(500).json({
        success: false,
        errorMessage: errorMessage,
        errorCode: 500,
      });
    }
  }
};

// 按国家统计ASIN当前状态
exports.getASINStatisticsByCountry = async (req, res) => {
  try {
    const statistics = await MonitorHistory.getASINStatisticsByCountry();

    res.json({
      success: true,
      data: statistics,
      errorCode: 0,
    });
  } catch (error) {
    console.error('按国家统计ASIN当前状态错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '查询失败',
      errorCode: 500,
    });
  }
};

// 按变体组统计ASIN当前状态
exports.getASINStatisticsByVariantGroup = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const statistics = await MonitorHistory.getASINStatisticsByVariantGroup({
      limit,
    });

    res.json({
      success: true,
      data: statistics,
      errorCode: 0,
    });
  } catch (error) {
    console.error('按变体组统计ASIN当前状态错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '查询失败',
      errorCode: 500,
    });
  }
};
