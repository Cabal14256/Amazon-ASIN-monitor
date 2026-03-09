export const PASSWORD_POLICY_HINT =
  '至少8位，且必须包含字母和数字，不能包含空格';

export function validateStrongPassword(password?: string) {
  if (!password) {
    return '请输入密码';
  }

  if (password.length < 8) {
    return '密码长度至少为8位';
  }

  if (!/[a-zA-Z]/.test(password)) {
    return '密码必须包含至少一个字母';
  }

  if (!/[0-9]/.test(password)) {
    return '密码必须包含至少一个数字';
  }

  if (/\s/.test(password)) {
    return '密码不能包含空格';
  }

  return null;
}
