const PASSWORD_CHANGE_REQUIRED_MESSAGE = '当前账户需要先修改密码';

function parseDateValue(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function isPasswordExpired(user) {
  const expiresAt = parseDateValue(user?.password_expires_at);
  if (!expiresAt) {
    return false;
  }

  return expiresAt <= new Date();
}

function isForcedPasswordChangeRequired(user, session = null) {
  if (!user?.force_password_change) {
    return false;
  }

  const sessionCreatedAt = parseDateValue(session?.created_at);
  const passwordChangedAt = parseDateValue(user?.password_changed_at);

  if (!sessionCreatedAt || !passwordChangedAt) {
    return true;
  }

  return sessionCreatedAt >= passwordChangedAt;
}

function isPasswordChangeRequired(user, session = null) {
  return (
    isPasswordExpired(user) || isForcedPasswordChangeRequired(user, session)
  );
}

module.exports = {
  PASSWORD_CHANGE_REQUIRED_MESSAGE,
  isPasswordExpired,
  isForcedPasswordChangeRequired,
  isPasswordChangeRequired,
};
