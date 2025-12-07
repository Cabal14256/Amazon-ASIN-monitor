/**
 * 会话清理服务
 * 定时清理过期会话
 */

const cron = require('node-cron');
const Session = require('../models/Session');
const logger = require('../utils/logger');

let cleanupJob = null;

/**
 * 启动会话清理定时任务
 * 每天凌晨2点执行
 */
function startSessionCleanup() {
  if (cleanupJob) {
    logger.warn('会话清理任务已启动，跳过重复启动');
    return;
  }

  // 每天凌晨2点执行清理
  cleanupJob = cron.schedule('0 2 * * *', async () => {
    try {
      logger.info('开始清理过期会话...');
      const deletedCount = await Session.cleanExpiredSessions();
      logger.info(`会话清理完成，删除了 ${deletedCount} 个过期会话`);
    } catch (error) {
      logger.error('会话清理失败:', error);
    }
  });

  logger.info('✅ 会话清理定时任务已启动（每天凌晨2点执行）');
}

/**
 * 停止会话清理定时任务
 */
function stopSessionCleanup() {
  if (cleanupJob) {
    cleanupJob.stop();
    cleanupJob = null;
    logger.info('会话清理定时任务已停止');
  }
}

/**
 * 手动执行一次清理
 */
async function cleanupNow() {
  try {
    logger.info('手动执行会话清理...');
    const deletedCount = await Session.cleanExpiredSessions();
    logger.info(`会话清理完成，删除了 ${deletedCount} 个过期会话`);
    return deletedCount;
  } catch (error) {
    logger.error('会话清理失败:', error);
    throw error;
  }
}

module.exports = {
  startSessionCleanup,
  stopSessionCleanup,
  cleanupNow,
};
