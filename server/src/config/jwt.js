module.exports = {
  secret: process.env.JWT_SECRET || 'amazon-asin-monitor-secret-key-change-in-production',
  expiresIn: process.env.JWT_EXPIRES_IN || '7d', // 7天过期
};

