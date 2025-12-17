const backupService = require('../services/backupService');
const BackupConfig = require('../models/BackupConfig');
const schedulerService = require('../services/schedulerService');

/**
 * 创建备份
 */
async function createBackup(req, res) {
  try {
    const { tables, description, useAsync } = req.body;
    const userId = req.user?.userId || req.user?.id;

    // 如果使用异步模式，创建后台任务
    if (useAsync === true) {
      const { v4: uuidv4 } = require('uuid');
      const backupTaskQueue = require('../services/backupTaskQueue');
      const logger = require('../utils/logger');

      const taskId = uuidv4();
      await backupTaskQueue.enqueue({
        taskId,
        taskType: 'create',
        params: { tables, description },
        userId,
      });

      logger.info(
        `[备份任务] 创建任务成功: ${taskId}, 类型: create, 用户: ${userId}`,
      );

      return res.json({
        success: true,
        data: {
          taskId,
          status: 'pending',
        },
        errorCode: 0,
      });
    }

    // 同步模式（原有逻辑）
    const result = await backupService.createBackup({ tables, description });

    res.json({
      success: true,
      data: result,
      errorCode: 0,
    });
  } catch (error) {
    console.error('创建备份失败:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '创建备份失败',
      errorCode: 500,
    });
  }
}

/**
 * 恢复备份
 */
async function restoreBackup(req, res) {
  try {
    const { filename, useAsync } = req.body;
    const userId = req.user?.userId || req.user?.id;

    if (!filename) {
      return res.status(400).json({
        success: false,
        errorMessage: '请指定备份文件名',
        errorCode: 400,
      });
    }

    // 如果使用异步模式，创建后台任务
    if (useAsync === true) {
      const { v4: uuidv4 } = require('uuid');
      const backupTaskQueue = require('../services/backupTaskQueue');
      const logger = require('../utils/logger');
      const path = require('path');

      const taskId = uuidv4();
      const filepath = path.join(__dirname, '../../backups', filename);

      await backupTaskQueue.enqueue({
        taskId,
        taskType: 'restore',
        params: { filepath },
        userId,
      });

      logger.info(
        `[备份任务] 创建任务成功: ${taskId}, 类型: restore, 文件: ${filename}, 用户: ${userId}`,
      );

      return res.json({
        success: true,
        data: {
          taskId,
          status: 'pending',
        },
        errorCode: 0,
      });
    }

    // 同步模式（原有逻辑）
    const { getBackupFile } = require('../services/backupService');
    const filepath = require('path').join(__dirname, '../../backups', filename);

    await backupService.restoreBackup(filepath);

    res.json({
      success: true,
      data: { message: '恢复成功' },
      errorCode: 0,
    });
  } catch (error) {
    console.error('恢复备份失败:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '恢复备份失败',
      errorCode: 500,
    });
  }
}

/**
 * 获取备份列表
 */
async function listBackups(req, res) {
  try {
    const backups = await backupService.listBackups();

    res.json({
      success: true,
      data: backups,
      errorCode: 0,
    });
  } catch (error) {
    console.error('获取备份列表失败:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '获取备份列表失败',
      errorCode: 500,
    });
  }
}

/**
 * 删除备份
 */
async function deleteBackup(req, res) {
  try {
    const { filename } = req.params;

    if (!filename) {
      return res.status(400).json({
        success: false,
        errorMessage: '请指定备份文件名',
        errorCode: 400,
      });
    }

    await backupService.deleteBackup(filename);

    res.json({
      success: true,
      data: { message: '删除成功' },
      errorCode: 0,
    });
  } catch (error) {
    console.error('删除备份失败:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '删除备份失败',
      errorCode: 500,
    });
  }
}

/**
 * 下载备份文件
 */
async function downloadBackup(req, res) {
  try {
    const { filename } = req.params;

    if (!filename) {
      return res.status(400).json({
        success: false,
        errorMessage: '请指定备份文件名',
        errorCode: 400,
      });
    }

    const fileBuffer = await backupService.getBackupFile(filename);

    res.setHeader('Content-Type', 'application/sql');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );

    res.send(fileBuffer);
  } catch (error) {
    console.error('下载备份失败:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '下载备份失败',
      errorCode: 500,
    });
  }
}

/**
 * 获取自动备份配置
 */
async function getBackupConfig(req, res) {
  try {
    const config = await BackupConfig.findOne();

    res.json({
      success: true,
      data: config,
      errorCode: 0,
    });
  } catch (error) {
    console.error('获取备份配置失败:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '获取备份配置失败',
      errorCode: 500,
    });
  }
}

/**
 * 保存自动备份配置
 */
async function saveBackupConfig(req, res) {
  try {
    const { enabled, scheduleType, scheduleValue, backupTime } = req.body;

    const config = await BackupConfig.upsert({
      enabled,
      scheduleType,
      scheduleValue,
      backupTime,
    });

    // 通知调度服务重新加载配置
    try {
      if (typeof schedulerService.reloadBackupSchedule === 'function') {
        await schedulerService.reloadBackupSchedule();
      }
    } catch (error) {
      console.error('重新加载备份计划失败:', error);
      // 不阻止响应，只记录错误
    }

    res.json({
      success: true,
      data: config,
      errorCode: 0,
    });
  } catch (error) {
    console.error('保存备份配置失败:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '保存备份配置失败',
      errorCode: 500,
    });
  }
}

module.exports = {
  createBackup,
  restoreBackup,
  listBackups,
  deleteBackup,
  downloadBackup,
  getBackupConfig,
  saveBackupConfig,
};
