const variantCheckService = require('../services/variantCheckService');

// 检查变体组
exports.checkVariantGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const result = await variantCheckService.checkVariantGroup(groupId);

    res.json({
      success: true,
      data: result,
      errorCode: 0,
    });
  } catch (error) {
    console.error('检查变体组错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '检查失败',
      errorCode: 500,
    });
  }
};

// 检查单个ASIN
exports.checkASIN = async (req, res) => {
  try {
    const { asinId } = req.params;
    const result = await variantCheckService.checkSingleASIN(asinId);

    res.json({
      success: true,
      data: result,
      errorCode: 0,
    });
  } catch (error) {
    console.error('检查ASIN错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '检查失败',
      errorCode: 500,
    });
  }
};

// 批量检查变体组
exports.batchCheckVariantGroups = async (req, res) => {
  try {
    const { groupIds, country } = req.body;

    if (!groupIds || !Array.isArray(groupIds) || groupIds.length === 0) {
      return res.status(400).json({
        success: false,
        errorMessage: '请提供变体组ID列表',
        errorCode: 400,
      });
    }

    const results = [];
    for (const groupId of groupIds) {
      try {
        const result = await variantCheckService.checkVariantGroup(groupId);
        results.push({
          groupId,
          success: true,
          ...result,
        });
      } catch (error) {
        results.push({
          groupId,
          success: false,
          error: error.message,
        });
      }
    }

    res.json({
      success: true,
      data: {
        total: groupIds.length,
        results,
      },
      errorCode: 0,
    });
  } catch (error) {
    console.error('批量检查错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '批量检查失败',
      errorCode: 500,
    });
  }
};
