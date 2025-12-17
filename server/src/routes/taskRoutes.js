const express = require('express');
const router = express.Router();
const taskController = require('../controllers/taskController');
const exportController = require('../controllers/exportController');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

// 创建导出任务（权限检查在控制器中进行，因为不同导出类型需要不同权限）
router.post('/tasks/export', exportController.createExportTask);

// 查询任务状态
router.get('/tasks/:taskId', taskController.getTaskStatus);

// 下载任务结果文件
router.get('/tasks/:taskId/download', taskController.downloadTaskFile);

module.exports = router;
