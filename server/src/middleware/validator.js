const Joi = require('joi');
const logger = require('../utils/logger');

// ASIN 格式验证（10位字母数字）
const asinSchema = Joi.string()
  .pattern(/^[A-Z0-9]{10}$/)
  .required();

// 国家代码验证
const countrySchema = Joi.string()
  .valid('US', 'UK', 'DE', 'FR', 'ES', 'IT', 'EU')
  .required();

// 通用验证中间件工厂
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      logger.warn('输入验证失败:', { errors, url: req.url });

      return res.status(400).json({
        success: false,
        errorMessage: '输入验证失败',
        errorCode: 400,
        errors,
      });
    }

    // 将验证后的值赋值回 req[source]
    req[source] = value;
    next();
  };
}

// 导出常用验证规则
module.exports = {
  validate,
  asinSchema,
  countrySchema,
  // 可以添加更多常用规则
};
