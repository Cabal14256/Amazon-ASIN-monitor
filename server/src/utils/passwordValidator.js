/**
 * 密码验证工具
 * 实现密码强度验证、弱密码检查等功能
 */

// 常见弱密码列表
const COMMON_WEAK_PASSWORDS = [
  'password',
  '123456',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty',
  'abc123',
  'password123',
  'admin',
  'admin123',
  'letmein',
  'welcome',
  'monkey',
  '1234567',
  'sunshine',
  'princess',
  'dragon',
  'passw0rd',
  'master',
  'hello',
];

/**
 * 验证密码强度
 * @param {string} password - 待验证的密码
 * @param {string} username - 用户名（可选，用于检查密码是否与用户名相同）
 * @returns {Object} 验证结果 { valid: boolean, errors: string[] }
 */
function validatePassword(password, username = null) {
  const errors = [];

  // 检查密码是否为空
  if (!password || password.trim().length === 0) {
    errors.push('密码不能为空');
    return { valid: false, errors };
  }

  // 检查密码长度（至少8位）
  if (password.length < 8) {
    errors.push('密码长度至少为8位');
  }

  // 检查是否包含字母
  if (!/[a-zA-Z]/.test(password)) {
    errors.push('密码必须包含至少一个字母');
  }

  // 检查是否包含数字
  if (!/[0-9]/.test(password)) {
    errors.push('密码必须包含至少一个数字');
  }

  // 检查密码是否与用户名相同
  if (username && password.toLowerCase() === username.toLowerCase()) {
    errors.push('密码不能与用户名相同');
  }

  // 检查是否为常见弱密码
  if (COMMON_WEAK_PASSWORDS.includes(password.toLowerCase())) {
    errors.push('密码过于简单，请使用更复杂的密码');
  }

  // 检查是否包含空格
  if (/\s/.test(password)) {
    errors.push('密码不能包含空格');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 获取密码强度等级
 * @param {string} password - 待评估的密码
 * @returns {string} 强度等级：'weak' | 'medium' | 'strong'
 */
function getPasswordStrength(password) {
  if (!password) return 'weak';

  let strength = 0;

  // 长度加分
  if (password.length >= 8) strength += 1;
  if (password.length >= 12) strength += 1;

  // 包含小写字母
  if (/[a-z]/.test(password)) strength += 1;

  // 包含大写字母
  if (/[A-Z]/.test(password)) strength += 1;

  // 包含数字
  if (/[0-9]/.test(password)) strength += 1;

  // 包含特殊字符
  if (/[^a-zA-Z0-9]/.test(password)) strength += 1;

  // 判断强度
  if (strength <= 2) return 'weak';
  if (strength <= 4) return 'medium';
  return 'strong';
}

module.exports = {
  validatePassword,
  getPasswordStrength,
  COMMON_WEAK_PASSWORDS,
};
