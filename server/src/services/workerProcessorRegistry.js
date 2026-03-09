const logger = require('../utils/logger');
const monitorTaskQueue = require('./monitorTaskQueue');
const competitorMonitorTaskQueue = require('./competitorMonitorTaskQueue');
const exportTaskQueue = require('./exportTaskQueue');
const importTaskQueue = require('./importTaskQueue');
const batchCheckTaskQueue = require('./batchCheckTaskQueue');
const backupTaskQueue = require('./backupTaskQueue');
const variantCheckTaskQueue = require('./variantCheckTaskQueue');

const queueRegistrations = [
  {
    name: 'monitor',
    aliases: ['monitor'],
    module: monitorTaskQueue,
  },
  {
    name: 'competitor',
    aliases: ['competitor'],
    module: competitorMonitorTaskQueue,
  },
  {
    name: 'export',
    aliases: ['export'],
    module: exportTaskQueue,
  },
  {
    name: 'import',
    aliases: ['import'],
    module: importTaskQueue,
  },
  {
    name: 'batchCheck',
    aliases: ['batchcheck', 'batch-check'],
    module: batchCheckTaskQueue,
  },
  {
    name: 'backup',
    aliases: ['backup'],
    module: backupTaskQueue,
  },
  {
    name: 'variantCheck',
    aliases: ['variantcheck', 'variant-check'],
    module: variantCheckTaskQueue,
  },
];

function normalizeQueueToken(token) {
  return String(token || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
}

function resolveQueueName(token) {
  const normalizedToken = normalizeQueueToken(token);
  const matched = queueRegistrations.find(({ name, aliases = [] }) => {
    const candidates = [name, ...aliases].map(normalizeQueueToken);
    return candidates.includes(normalizedToken);
  });

  return matched ? matched.name : null;
}

function getWorkerQueueConfig() {
  const raw = String(process.env.WORKER_ENABLED_QUEUES || '').trim();

  if (!raw) {
    return {
      enableAll: true,
      enabledQueues: queueRegistrations.map(({ name }) => name),
      unknownQueues: [],
    };
  }

  const tokens = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return {
      enableAll: true,
      enabledQueues: queueRegistrations.map(({ name }) => name),
      unknownQueues: [],
    };
  }

  if (
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

    const resolvedName = resolveQueueName(token);
    if (!resolvedName) {
      unknownQueues.push(token);
      return;
    }
    enabledQueues.add(resolvedName);
  });

  return {
    enableAll: false,
    enabledQueues: Array.from(enabledQueues),
    unknownQueues,
  };
}

function isQueueEnabled(name, config = getWorkerQueueConfig()) {
  if (config.enableAll) {
    return true;
  }
  return config.enabledQueues.includes(name);
}

function registerWorkerProcessors() {
  const newlyRegisteredQueues = [];
  const skippedQueues = [];
  const config = getWorkerQueueConfig();

  if (config.unknownQueues.length > 0) {
    logger.warn(
      `[Worker] WORKER_ENABLED_QUEUES 包含未知队列名: ${config.unknownQueues.join(
        ', ',
      )}`,
    );
  }

  queueRegistrations.forEach(({ name, module }) => {
    if (!isQueueEnabled(name, config)) {
      skippedQueues.push(name);
      return;
    }

    const didRegister = module.registerProcessor();
    if (didRegister) {
      newlyRegisteredQueues.push(name);
    }
  });

  const registeredQueues = getRegisteredQueueNames();
  logger.info(
    `[Worker] 队列处理器注册完成，当前已注册: ${
      registeredQueues.length > 0 ? registeredQueues.join(', ') : '无'
    }`,
  );
  if (skippedQueues.length > 0) {
    logger.info(
      `[Worker] 根据 WORKER_ENABLED_QUEUES 跳过队列: ${skippedQueues.join(
        ', ',
      )}`,
    );
  }

  return {
    registeredQueues,
    newlyRegisteredQueues,
    skippedQueues,
    enabledQueues: config.enabledQueues,
  };
}

function getRegisteredQueueNames() {
  return queueRegistrations
    .filter(({ module }) => module.getProcessorStatus().registered)
    .map(({ name }) => name);
}

function getWorkerRegistrationStatus() {
  const config = getWorkerQueueConfig();
  const details = {};
  queueRegistrations.forEach(({ name, module }) => {
    details[name] = {
      ...module.getProcessorStatus(),
      enabledByConfig: isQueueEnabled(name, config),
    };
  });

  const registeredQueues = Object.keys(details).filter(
    (name) => details[name].registered,
  );

  return {
    registeredQueues,
    enabledQueues: config.enabledQueues,
    skippedQueues: queueRegistrations
      .map(({ name }) => name)
      .filter((name) => !isQueueEnabled(name, config)),
    details,
  };
}

function getRegisteredQueueInstances() {
  return queueRegistrations
    .filter(({ module }) => module.getProcessorStatus().registered)
    .map(({ module }) => module.queue);
}

module.exports = {
  registerWorkerProcessors,
  getRegisteredQueueNames,
  getWorkerRegistrationStatus,
  getRegisteredQueueInstances,
  getWorkerQueueConfig,
};
