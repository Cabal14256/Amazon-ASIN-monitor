const DEFAULT_PROCESS_ROLE = 'all';
const VALID_PROCESS_ROLES = ['api', 'worker', 'all'];

function normalizeProcessRole(value) {
  const normalized = String(value || DEFAULT_PROCESS_ROLE)
    .trim()
    .toLowerCase();
  if (VALID_PROCESS_ROLES.includes(normalized)) {
    return normalized;
  }
  return DEFAULT_PROCESS_ROLE;
}

function getProcessRole() {
  return normalizeProcessRole(process.env.PROCESS_ROLE);
}

function isApiRole(role = getProcessRole()) {
  return role === 'api' || role === 'all';
}

function isWorkerRole(role = getProcessRole()) {
  return role === 'worker' || role === 'all';
}

module.exports = {
  DEFAULT_PROCESS_ROLE,
  VALID_PROCESS_ROLES,
  normalizeProcessRole,
  getProcessRole,
  isApiRole,
  isWorkerRole,
};
