const express = require('express');
const router = express.Router();
const competitorMonitorController = require('../controllers/competitorMonitorController');
const {
  triggerCompetitorManualCheck,
} = require('../services/competitorMonitorTaskRunner');

// 竞品监控历史路由（不包含数据分析路由）
router.get(
  '/competitor/monitor-history/:id',
  competitorMonitorController.getCompetitorMonitorHistoryById,
);
router.get(
  '/competitor/monitor-history',
  competitorMonitorController.getCompetitorMonitorHistory,
);

// 手动触发竞品监控检查
router.post('/competitor/monitor/trigger', async (req, res) => {
  try {
    const { countries } = req.body;
    const result = await triggerCompetitorManualCheck(countries || null);
    res.json({
      success: result.success,
      data: result,
      errorCode: result.success ? 0 : 500,
      errorMessage: result.error,
    });
  } catch (error) {
    console.error('触发竞品监控检查错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '触发失败',
      errorCode: 500,
    });
  }
});

module.exports = router;
