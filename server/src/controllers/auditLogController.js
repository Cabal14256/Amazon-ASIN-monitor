const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');

/**
 * 获取审计日志列表
 */
async function getAuditLogList(req, res) {
  try {
    const {
      userId,
      username,
      action,
      resource,
      resourceId,
      startTime,
      endTime,
      current = 1,
      pageSize = 10,
    } = req.query;

    const result = await AuditLog.findAll({
      userId,
      username,
      action,
      resource,
      resourceId,
      startTime,
      endTime,
      current: Number(current),
      pageSize: Number(pageSize),
    });

    res.json({
      success: true,
      data: result,
      errorCode: 0,
    });
  } catch (error) {
    logger.error('获取审计日志列表失败:', error);
    res.status(500).json({
      success: false,
      errorMessage: `获取审计日志列表失败: ${error.message}`,
      errorCode: 500,
      errorDetails:
        process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
}

/**
 * 获取审计日志详情
 */
async function getAuditLogDetail(req, res) {
  try {
    const { id } = req.params;
    const log = await AuditLog.findById(id);

    if (!log) {
      return res.status(404).json({
        success: false,
        errorMessage: '审计日志不存在',
      });
    }

    // 解析request_data
    if (log.request_data) {
      try {
        log.requestData = JSON.parse(log.request_data);
      } catch (e) {
        log.requestData = log.request_data;
      }
    }

    res.json({
      success: true,
      data: log,
    });
  } catch (error) {
    logger.error('获取审计日志详情失败:', error);
    res.status(500).json({
      success: false,
      errorMessage: '获取审计日志详情失败',
    });
  }
}

/**
 * 获取操作类型统计
 */
async function getActionStatistics(req, res) {
  try {
    const { startTime, endTime } = req.query;
    const result = await AuditLog.getActionStatistics({
      startTime,
      endTime,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('获取操作类型统计失败:', error);
    res.status(500).json({
      success: false,
      errorMessage: '获取操作类型统计失败',
    });
  }
}

/**
 * 获取资源类型统计
 */
async function getResourceStatistics(req, res) {
  try {
    const { startTime, endTime } = req.query;
    const result = await AuditLog.getResourceStatistics({
      startTime,
      endTime,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('获取资源类型统计失败:', error);
    res.status(500).json({
      success: false,
      errorMessage: '获取资源类型统计失败',
    });
  }
}

module.exports = {
  getAuditLogList,
  getAuditLogDetail,
  getActionStatistics,
  getResourceStatistics,
};
