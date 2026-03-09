const USER_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  LOCKED: 'LOCKED',
  SUSPENDED: 'SUSPENDED',
  PENDING: 'PENDING',
});

function normalizeUserStatus(status, lockedUntil = null) {
  if (status === USER_STATUS.LOCKED) {
    return USER_STATUS.LOCKED;
  }

  if (
    lockedUntil &&
    !Number.isNaN(new Date(lockedUntil).getTime()) &&
    new Date(lockedUntil) > new Date()
  ) {
    return USER_STATUS.LOCKED;
  }

  if (typeof status === 'string') {
    const normalized = status.trim().toUpperCase();
    if (Object.values(USER_STATUS).includes(normalized)) {
      return normalized;
    }
    if (normalized === '1') {
      return USER_STATUS.ACTIVE;
    }
    if (normalized === '0') {
      return USER_STATUS.INACTIVE;
    }
  }

  if (status === 1 || status === true) {
    return USER_STATUS.ACTIVE;
  }

  if (status === 0 || status === false) {
    return USER_STATUS.INACTIVE;
  }

  return USER_STATUS.INACTIVE;
}

function isUserActive(status, lockedUntil = null) {
  return normalizeUserStatus(status, lockedUntil) === USER_STATUS.ACTIVE;
}

function toDatabaseStatus(status) {
  const normalized = normalizeUserStatus(status);
  return normalized;
}

function getUserStatusErrorMessage(status, lockedUntil = null) {
  switch (normalizeUserStatus(status, lockedUntil)) {
    case USER_STATUS.LOCKED:
      return '账户已锁定';
    case USER_STATUS.SUSPENDED:
      return '用户已被停用';
    case USER_STATUS.PENDING:
      return '账户待激活';
    case USER_STATUS.INACTIVE:
    default:
      return '用户已被禁用';
  }
}

module.exports = {
  USER_STATUS,
  normalizeUserStatus,
  isUserActive,
  toDatabaseStatus,
  getUserStatusErrorMessage,
};
