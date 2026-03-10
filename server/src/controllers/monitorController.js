const MonitorHistory = require('../models/MonitorHistory');
const logger = require('../utils/logger');
const analyticsViewService = require('../services/analyticsViewService');

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
      variantGroupName,
      asinName,
      asinType,
      country,
      checkType,
      isBroken,
      startTime,
      endTime,
      current,
      pageSize,
    } = req.query;

    // 处理多ASIN查询：支持逗号/空白符分隔，多个值走精确匹配
    let asinParam = asin;
    if (asin && typeof asin === 'string') {
      const trimmed = asin.trim();
      if (trimmed) {
        const asinList = [
          ...new Set(
            trimmed
              .split(/[,\s]+/)
              .map((s) => s.trim())
              .filter((s) => s.length > 0),
          ),
        ];
        if (asinList.length > 1) {
          asinParam = asinList;
        } else if (asinList.length === 1) {
          asinParam = asinList[0];
        } else {
          asinParam = '';
        }
      } else {
        asinParam = '';
      }
    }

    const result = await MonitorHistory.findAll({
      variantGroupId,
      asinId,
      asin: asinParam,
      variantGroupName,
      asinName,
      asinType,
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
    logger.error('查询监控历史错误:', error);
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
    logger.error('查询监控历史详情错误:', error);
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
    const { variantGroupId, asinId, country, checkType, startTime, endTime } =
      req.query;
    const statistics = await MonitorHistory.getStatistics({
      variantGroupId,
      asinId,
      country,
      checkType,
      startTime,
      endTime,
    });

    res.json({
      success: true,
      data: statistics,
      errorCode: 0,
    });
  } catch (error) {
    logger.error('获取统计信息错误:', error);
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
    logger.error('按国家统计错误:', error);
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
    logger.error('按变体组统计错误:', error);
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
    const {
      country,
      checkType,
      startTime: startTimeParam,
      endTime,
    } = req.query;

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
          checkType,
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

// 月度异常时长统计（服务端衍生结果）
exports.getAnalyticsMonthlyBreakdown = async (req, res) => {
  const startTime = Date.now();
  try {
    const { country, month, startTime: startTimeParam, endTime } = req.query;

    const now = new Date();
    const fallbackMonth = `${now.getFullYear()}-${String(
      now.getMonth() + 1,
    ).padStart(2, '0')}`;
    const monthTokenCandidate =
      month || String(startTimeParam || '').slice(0, 7);
    const monthToken = /^\d{4}-\d{2}$/.test(monthTokenCandidate)
      ? monthTokenCandidate
      : fallbackMonth;
    const [yearText, monthText] = monthToken.split('-');
    const year = Number(yearText) || now.getFullYear();
    const monthNumber = Math.min(
      12,
      Math.max(1, Number(monthText) || now.getMonth() + 1),
    );
    const daysInMonth = new Date(year, monthNumber, 0).getDate();
    const effectiveStartTime =
      startTimeParam ||
      `${year}-${String(monthNumber).padStart(2, '0')}-01 00:00:00`;
    const effectiveEndTime =
      endTime ||
      `${year}-${String(monthNumber).padStart(2, '0')}-${String(
        daysInMonth,
      ).padStart(2, '0')} 23:59:59`;

    const statistics = await withRetry(
      async () =>
        MonitorHistory.getStatisticsByTime({
          country,
          startTime: effectiveStartTime,
          endTime: effectiveEndTime,
          groupBy: 'day',
        }),
      3,
      1000,
    );

    const result = analyticsViewService.buildMonthlyBreakdownRows(
      statistics,
      `${year}-${String(monthNumber).padStart(2, '0')}`,
    );
    const duration = Date.now() - startTime;
    logger.info(
      `[统计查询] getAnalyticsMonthlyBreakdown 完成，耗时${duration}ms`,
    );

    res.json({
      success: true,
      data: result,
      errorCode: 0,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(
      `[统计查询] getAnalyticsMonthlyBreakdown 失败，耗时${duration}ms:`,
      error,
    );
    res.status(500).json({
      success: false,
      errorMessage: error.message || '查询失败',
      errorCode: 500,
    });
  }
};

// 高峰期标记区域（服务端衍生结果）
exports.getAnalyticsPeakMarkAreas = async (req, res) => {
  try {
    const { groupBy = 'hour', country = '', startTime, endTime } = req.query;

    if (!startTime || !endTime) {
      return res.status(400).json({
        success: false,
        errorMessage: '请提供开始时间和结束时间',
        errorCode: 400,
      });
    }

    const areas = analyticsViewService.buildPeakHoursMarkAreas({
      groupBy,
      country,
      startTime,
      endTime,
    });

    res.json({
      success: true,
      data: areas,
      errorCode: 0,
    });
  } catch (error) {
    logger.error('获取高峰期标记区域失败:', error);
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
    const { countries } = req.body || {};
    const monitorTaskQueue = require('../services/monitorTaskQueue');
    const { REGION_MAP } = require('../services/monitorTaskRunner');
    const allCountries = Object.keys(REGION_MAP);
    let normalizedCountries = allCountries;

    if (countries !== undefined) {
      if (!Array.isArray(countries)) {
        return res.status(400).json({
          success: false,
          errorMessage: 'countries 必须是数组',
          errorCode: 400,
        });
      }

      normalizedCountries = [
        ...new Set(
          countries
            .map((country) =>
              String(country || '')
                .trim()
                .toUpperCase(),
            )
            .filter((country) => allCountries.includes(country)),
        ),
      ];

      if (normalizedCountries.length === 0) {
        return res.status(400).json({
          success: false,
          errorMessage: '没有可执行的有效国家代码',
          errorCode: 400,
        });
      }
    }

    logger.info(
      `[手动检查] 收到手动检查请求，国家: ${normalizedCountries.join(', ')}`,
    );

    const job = await monitorTaskQueue.enqueue(normalizedCountries, null, {
      source: 'manual',
      requestedBy: req.user?.id || null,
      jobOptions: {
        priority: 1,
      },
    });

    res.json({
      success: true,
      data: {
        message: '监控任务已入队',
        queued: true,
        jobId: job?.id || null,
        countries: normalizedCountries,
      },
      errorCode: 0,
    });
  } catch (error) {
    logger.error('手动触发监控检查错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '任务入队失败',
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
      duration > 600000; // 如果耗时超过10分钟，也认为是超时

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
      `[统计查询] getPeriodSummary 完成，总耗时${duration}ms，返回${
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
      duration > 600000; // 如果耗时超过10分钟，也认为是超时

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

// 按国家统计ASIN时长
exports.getASINStatisticsByCountry = async (req, res) => {
  try {
    const { country, startTime, endTime } = req.query;
    const statistics = await MonitorHistory.getASINStatisticsByCountry({
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
    logger.error('按国家统计ASIN时长错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '查询失败',
      errorCode: 500,
    });
  }
};

// 按变体组统计ASIN时长
exports.getASINStatisticsByVariantGroup = async (req, res) => {
  try {
    const { limit = 10, country, startTime, endTime } = req.query;
    const statistics = await MonitorHistory.getASINStatisticsByVariantGroup({
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
    logger.error('按变体组统计ASIN时长错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '查询失败',
      errorCode: 500,
    });
  }
};

// 获取异常时长统计
exports.getAbnormalDurationStatistics = async (req, res) => {
  try {
    const {
      asinIds,
      asinCodes,
      variantGroupId,
      country,
      startTime,
      endTime,
      includeSeries = '1',
      asinType,
      asinName,
      variantGroupName,
    } = req.query;

    // 处理asinIds参数：可能是逗号分隔的字符串或数组
    let asinIdsArray = [];
    if (asinIds) {
      if (typeof asinIds === 'string') {
        asinIdsArray = asinIds
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id.length > 0);
      } else if (Array.isArray(asinIds)) {
        asinIdsArray = asinIds;
      }
    }

    // 处理asinCodes参数：可能是逗号分隔的字符串或数组
    let asinCodesArray = [];
    if (asinCodes) {
      if (typeof asinCodes === 'string') {
        asinCodesArray = asinCodes
          .split(',')
          .map((code) => code.trim())
          .filter((code) => code.length > 0);
      } else if (Array.isArray(asinCodes)) {
        asinCodesArray = asinCodes;
      }
    }

    const statistics = await MonitorHistory.getAbnormalDurationStatistics({
      asinIds: asinIdsArray,
      asinCodes: asinCodesArray,
      variantGroupId,
      country,
      startTime,
      endTime,
      includeSeries,
      asinType,
      asinName,
      variantGroupName,
    });

    res.json({
      success: true,
      data: statistics,
      errorCode: 0,
    });
  } catch (error) {
    logger.error('获取异常时长统计错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '查询失败',
      errorCode: 500,
    });
  }
};
