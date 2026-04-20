const analyticsService = require('../services/analyticsService');
const logger = require('../utils/logger');

async function withRetry(fn, maxRetries = 3, delay = 1000) {
  let lastError;
  for (let index = 0; index < maxRetries; index += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const errorCode = error.code || '';
      const errorMessage = error.message || '';
      const shouldRetry =
        index < maxRetries - 1 &&
        (errorCode === 'ETIMEDOUT' ||
          errorCode === 'PROTOCOL_CONNECTION_LOST' ||
          errorCode === 'ECONNRESET' ||
          errorMessage.includes('timeout') ||
          errorMessage.includes('Connection lost') ||
          errorMessage.includes('Lock wait timeout'));

      if (!shouldRetry) {
        throw error;
      }

      const retryDelay = delay * (index + 1);
      logger.warn(
        `[Analytics] retry=${
          index + 1
        }/${maxRetries}, delayMs=${retryDelay}, message=${errorMessage}`,
      );
      await new Promise((resolve) => {
        setTimeout(resolve, retryDelay);
      });
    }
  }

  throw lastError;
}

function sendAnalyticsResult(res, result) {
  res.json({
    success: true,
    data: result?.data ?? result,
    meta: result?.meta,
    errorCode: 0,
  });
}

function validateTimeRange(res, startTime, endTime) {
  if (!startTime || !endTime) {
    res.status(400).json({
      success: false,
      errorMessage: '请提供开始时间和结束时间',
      errorCode: 400,
    });
    return false;
  }

  return true;
}

exports.getOverview = async (req, res) => {
  const startedAt = Date.now();
  try {
    const {
      country = '',
      startTime = '',
      endTime = '',
      groupBy = 'day',
      timeSlotGranularity = 'day',
      allCountriesTimeSlotGranularity = '',
      regionTimeSlotGranularity = '',
      variantGroupLimit = 10,
    } = req.query;

    if (!validateTimeRange(res, startTime, endTime)) {
      return;
    }

    const result = await withRetry(
      () =>
        analyticsService.getOverview({
          country,
          startTime,
          endTime,
          groupBy,
          timeSlotGranularity,
          allCountriesTimeSlotGranularity,
          regionTimeSlotGranularity,
          variantGroupLimit: Number(variantGroupLimit) || 10,
        }),
      3,
      1000,
    );

    logger.info(
      `[Analytics] getOverview completed, durationMs=${Date.now() - startedAt}`,
    );
    sendAnalyticsResult(res, result);
  } catch (error) {
    logger.error('[Analytics] getOverview failed', {
      message: error.message,
      durationMs: Date.now() - startedAt,
    });
    res.status(500).json({
      success: false,
      errorMessage: error.message || '查询失败',
      errorCode: 500,
    });
  }
};

exports.getMonitorHistorySummary = async (req, res) => {
  const startedAt = Date.now();
  try {
    const {
      variantGroupId = '',
      asinId = '',
      country = '',
      checkType = '',
      startTime = '',
      endTime = '',
    } = req.query;

    const result = await withRetry(
      () =>
        analyticsService.getMonitorHistorySummary({
          variantGroupId,
          asinId,
          country,
          checkType,
          startTime,
          endTime,
        }),
      3,
      1000,
    );

    logger.info(
      `[Analytics] getMonitorHistorySummary completed, durationMs=${
        Date.now() - startedAt
      }`,
    );
    sendAnalyticsResult(res, result);
  } catch (error) {
    logger.error('[Analytics] getMonitorHistorySummary failed', {
      message: error.message,
      durationMs: Date.now() - startedAt,
    });
    res.status(500).json({
      success: false,
      errorMessage: error.message || '查询失败',
      errorCode: 500,
    });
  }
};

exports.getMonitorHistoryPeakHours = async (req, res) => {
  const startedAt = Date.now();
  try {
    const {
      country = '',
      checkType = '',
      startTime = '',
      endTime = '',
    } = req.query;

    if (!country) {
      return res.status(400).json({
        success: false,
        errorMessage: '高峰期统计需要指定国家',
        errorCode: 400,
      });
    }

    const result = await withRetry(
      () =>
        analyticsService.getMonitorHistoryPeakHours({
          country,
          checkType,
          startTime,
          endTime,
        }),
      3,
      1000,
    );

    logger.info(
      `[Analytics] getMonitorHistoryPeakHours completed, durationMs=${
        Date.now() - startedAt
      }`,
    );
    sendAnalyticsResult(res, result);
  } catch (error) {
    logger.error('[Analytics] getMonitorHistoryPeakHours failed', {
      message: error.message,
      durationMs: Date.now() - startedAt,
    });
    res.status(500).json({
      success: false,
      errorMessage: error.message || '查询失败',
      errorCode: 500,
    });
  }
};

exports.getPeriodSummary = async (req, res) => {
  const startedAt = Date.now();
  try {
    const {
      country = '',
      site = '',
      brand = '',
      startTime = '',
      endTime = '',
      timeSlotGranularity = 'day',
      current = 1,
      pageSize = 10,
    } = req.query;

    const result = await withRetry(
      () =>
        analyticsService.getPeriodSummary({
          country,
          site,
          brand,
          startTime,
          endTime,
          timeSlotGranularity,
          current,
          pageSize,
        }),
      3,
      2000,
    );

    logger.info(
      `[Analytics] getPeriodSummary completed, durationMs=${
        Date.now() - startedAt
      }`,
    );
    sendAnalyticsResult(res, result);
  } catch (error) {
    logger.error('[Analytics] getPeriodSummary failed', {
      message: error.message,
      durationMs: Date.now() - startedAt,
    });
    res.status(500).json({
      success: false,
      errorMessage: error.message || '查询失败',
      errorCode: 500,
    });
  }
};

exports.getPeriodSummaryTimeSlotDetails = async (req, res) => {
  const startedAt = Date.now();
  try {
    const {
      country = '',
      site = '',
      brand = '',
      startTime = '',
      endTime = '',
      timeSlotGranularity = 'day',
    } = req.query;

    const result = await withRetry(
      () =>
        analyticsService.getPeriodSummaryTimeSlotDetails({
          country,
          site,
          brand,
          startTime,
          endTime,
          timeSlotGranularity,
        }),
      3,
      2000,
    );

    logger.info(
      `[Analytics] getPeriodSummaryTimeSlotDetails completed, durationMs=${
        Date.now() - startedAt
      }`,
    );
    sendAnalyticsResult(res, result);
  } catch (error) {
    logger.error('[Analytics] getPeriodSummaryTimeSlotDetails failed', {
      message: error.message,
      durationMs: Date.now() - startedAt,
    });
    res.status(500).json({
      success: false,
      errorMessage: error.message || '查询失败',
      errorCode: 500,
    });
  }
};

exports.getMonthlyBreakdown = async (req, res) => {
  const startedAt = Date.now();
  try {
    const {
      country = '',
      month = '',
      startTime = '',
      endTime = '',
    } = req.query;

    const result = await withRetry(
      () =>
        analyticsService.getMonthlyBreakdown({
          country,
          month,
          startTime,
          endTime,
        }),
      3,
      1000,
    );

    logger.info(
      `[Analytics] getMonthlyBreakdown completed, durationMs=${
        Date.now() - startedAt
      }`,
    );
    sendAnalyticsResult(res, result);
  } catch (error) {
    logger.error('[Analytics] getMonthlyBreakdown failed', {
      message: error.message,
      durationMs: Date.now() - startedAt,
    });
    res.status(500).json({
      success: false,
      errorMessage: error.message || '查询失败',
      errorCode: 500,
    });
  }
};
