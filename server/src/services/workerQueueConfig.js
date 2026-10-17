function normalizeQueueToken(token) {
  return String(token || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
}

function resolveQueueName(token, queueRegistrations) {
  const normalizedToken = normalizeQueueToken(token);
  const matched = queueRegistrations.find(({ name, aliases = [] }) => {
    const candidates = [name, ...aliases].map(normalizeQueueToken);
    return candidates.includes(normalizedToken);
  });

  return matched ? matched.name : null;
}

function getWorkerQueueConfig(
  queueRegistrations,
  raw = process.env.WORKER_ENABLED_QUEUES,
) {
  const normalizedRaw = String(raw || '').trim();
  if (!normalizedRaw) {
    return {
      enableAll: true,
      enabledQueues: queueRegistrations.map(({ name }) => name),
      unknownQueues: [],
    };
  }

  const tokens = normalizedRaw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (
    tokens.length === 0 ||
    tokens.some((token) => ['all', '*'].includes(normalizeQueueToken(token)))
  ) {
    return {
      enableAll: true,
      enabledQueues: queueRegistrations.map(({ name }) => name),
      unknownQueues: [],
    };
  }

  const enabledQueues = new Set();
  const unknownQueues = [];

  tokens.forEach((token) => {
    const normalized = normalizeQueueToken(token);
    if (['none', 'off'].includes(normalized)) {
      return;
    }

    const resolvedName = resolveQueueName(token, queueRegistrations);
    if (!resolvedName) {
      unknownQueues.push(token);
      return;
    }
    enabledQueues.add(resolvedName);
  });

  const monitorAllSelected = tokens.some(
    (token) => normalizeQueueToken(token) === 'monitor',
  );
  if (monitorAllSelected) {
    enabledQueues.add('monitorEu');
  }

  return {
    enableAll: false,
    enabledQueues: Array.from(enabledQueues),
    unknownQueues,
  };
}

function isQueueEnabled(name, config) {
  return config.enableAll || config.enabledQueues.includes(name);
}

module.exports = {
  normalizeQueueToken,
  resolveQueueName,
  getWorkerQueueConfig,
  isQueueEnabled,
};
