const MonitorHistory = require('../models/MonitorHistory');
const logger = require('../utils/logger');

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
