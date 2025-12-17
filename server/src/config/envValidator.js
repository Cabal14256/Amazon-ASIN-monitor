const logger = require('../utils/logger');

// 必需的环境变量列表
const REQUIRED_ENV_VARS = [
  'DB_HOST',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'JWT_SECRET',
];

// 可选但推荐的环境变量
const RECOMMENDED_ENV_VARS = ['NODE_ENV', 'LOG_LEVEL', 'PORT'];

/**
 * 验证环境变量
 * @throws {Error} 如果缺少必需的环境变量
 */
function validateEnv() {
  const missing = [];
  const warnings = [];

  // 检查必需的变量
  REQUIRED_ENV_VARS.forEach((varName) => {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  });

  // 检查推荐的变量
  RECOMMENDED_ENV_VARS.forEach((varName) => {
    if (!process.env[varName]) {
      warnings.push(varName);
    }
  });

  if (missing.length > 0) {
    logger.error('❌ 缺少必需的环境变量:');
    missing.forEach((varName) => {
      logger.error(`   - ${varName}`);
    });
    throw new Error(`缺少必需的环境变量: ${missing.join(', ')}`);
  }

  if (warnings.length > 0) {
    logger.warn('⚠️  推荐设置以下环境变量:');
    warnings.forEach((varName) => {
      logger.warn(`   - ${varName}`);
    });
  }

  logger.info('✅ 环境变量验证通过');
}

module.exports = { validateEnv };
