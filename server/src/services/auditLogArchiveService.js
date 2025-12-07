/**
 * 审计日志归档服务
 * 定时归档旧的审计日志
 */

const cron = require('node-cron');
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');

let archiveJob = null;

/**
 * 启动日志归档定时任务
 * 每月1号凌晨3点执行
 */
function startArchiveJob() {
  if (archiveJob) {
    logger.warn('日志归档任务已启动，跳过重复启动');
    return;
  }

  // 每月1号凌晨3点执行归档
  archiveJob = cron.schedule('0 3 1 * *', async () => {
    try {
      logger.info('开始归档审计日志...');
      const archivedCount = await AuditLog.archiveOldLogs(90); // 归档超过90天的日志
      logger.info(`审计日志归档完成，归档了 ${archivedCount} 条记录`);
    } catch (error) {
      logger.error('审计日志归档失败:', error);
    }
  });

  logger.info('✅ 审计日志归档定时任务已启动（每月1号凌晨3点执行）');
}

/**
 * 停止日志归档定时任务
 */
function stopArchiveJob() {
  if (archiveJob) {
    archiveJob.stop();
    archiveJob = null;
    logger.info('审计日志归档定时任务已停止');
  }
}

/**
 * 手动执行一次归档
 * @param {number} days - 保留天数
 */
async function archiveNow(days = 90) {
  try {
    logger.info(`手动执行审计日志归档（保留最近${days}天）...`);
    const archivedCount = await AuditLog.archiveOldLogs(days);
    logger.info(`审计日志归档完成，归档了 ${archivedCount} 条记录`);
    return archivedCount;
  } catch (error) {
    logger.error('审计日志归档失败:', error);
    throw error;
  }
}

module.exports = {
  startArchiveJob,
  stopArchiveJob,
  archiveNow,
};
