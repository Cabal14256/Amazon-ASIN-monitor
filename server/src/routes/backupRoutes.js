const express = require('express');
const router = express.Router();
const backupController = require('../controllers/backupController');
const { authenticateToken, checkPermission } = require('../middleware/auth');

router.use(authenticateToken);

// 所有备份操作需要系统设置权限
router.use(checkPermission('settings:write'));

// 创建备份
router.post('/backup', backupController.createBackup);

// 恢复备份
router.post('/backup/restore', backupController.restoreBackup);

// 获取备份列表
router.get('/backup', backupController.listBackups);

// 删除备份
router.delete('/backup/:filename', backupController.deleteBackup);

// 下载备份
router.get('/backup/:filename/download', backupController.downloadBackup);

module.exports = router;

