const backupService = require('../services/backupService');

/**
 * 创建备份
 */
async function createBackup(req, res) {
  try {
    const { tables, description } = req.body;

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
    const { filename } = req.body;

    if (!filename) {
      return res.status(400).json({
        success: false,
        errorMessage: '请指定备份文件名',
        errorCode: 400,
      });
    }

    const { getBackupFile } = require('../services/backupService');
    const filepath = require('path').join(
      __dirname,
      '../../backups',
      filename,
    );

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

    res.setHeader(
      'Content-Type',
      'application/sql',
    );
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

module.exports = {
  createBackup,
  restoreBackup,
  listBackups,
  deleteBackup,
  downloadBackup,
};

