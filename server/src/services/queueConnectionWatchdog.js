const logger = require('../utils/logger');

const DEFAULT_CHECK_INTERVAL_MS = 15000;
const DEFAULT_PING_TIMEOUT_MS = 5000;
const DEFAULT_UNHEALTHY_MS = 60000;
const DEFAULT_ACTIVE_JOB_MAX_AGE_MS = 20 * 60 * 1000;

function readPositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function withTimeout(
  promise,
  timeoutMs,
  setTimeoutFn = setTimeout,
  label = 'Redis operation',
) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeoutFn(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function checkQueueConnection(queue, options = {}) {
  const pingTimeoutMs = readPositiveNumber(
    options.pingTimeoutMs,
    DEFAULT_PING_TIMEOUT_MS,
  );
  const client = queue?.client;
  if (!client || typeof client.ping !== 'function') {
    throw new Error('Bull Redis client is unavailable');
  }

  await withTimeout(
    client.ping(),
    pingTimeoutMs,
    options.setTimeoutFn || setTimeout,
    'Redis ping',
  );

  if (!options.checkBacklogProgress) {
    return;
  }

  const activeJobMaxAgeMs = readPositiveNumber(
    options.activeJobMaxAgeMs || process.env.QUEUE_ACTIVE_JOB_MAX_AGE_MS,
    DEFAULT_ACTIVE_JOB_MAX_AGE_MS,
  );
  const now = options.now || Date.now;
  const { paused, counts, activeJobs } = await withTimeout(
    (async () => {
      const [isPaused, jobCounts] = await Promise.all([
        queue.isPaused(),
        queue.getJobCounts('waiting', 'active'),
      ]);
      const shouldInspectActiveJobs =
        !isPaused &&
        Number(jobCounts.waiting) > 0 &&
        Number(jobCounts.active) > 0;
      return {
        paused: isPaused,
        counts: jobCounts,
        activeJobs: shouldInspectActiveJobs ? await queue.getActive(0, -1) : [],
      };
    })(),
    pingTimeoutMs,
    options.setTimeoutFn || setTimeout,
    'Redis backlog health check',
  );
  if (!paused && Number(counts.waiting) > 0 && Number(counts.active) === 0) {
    throw new Error(
      `queue_not_consuming waiting=${counts.waiting} active=${counts.active}`,
    );
  }
  if (!paused && Number(counts.waiting) > 0 && Number(counts.active) > 0) {
    const processedTimes = activeJobs
      .map((job) => Number(job?.processedOn))
      .filter((processedOn) => Number.isFinite(processedOn) && processedOn > 0);
    const oldestProcessedOn =
      processedTimes.length > 0 ? Math.min(...processedTimes) : null;
    const oldestActiveAgeMs =
      oldestProcessedOn === null
        ? null
        : Math.max(now() - oldestProcessedOn, 0);

    if (oldestActiveAgeMs === null || oldestActiveAgeMs > activeJobMaxAgeMs) {
      throw new Error(
        `active_job_stalled waiting=${counts.waiting} active=${counts.active} oldestAgeMs=${oldestActiveAgeMs}`,
      );
    }
  }
}

function startQueueConnectionWatchdog(queues, options = {}) {
  const queueList = (queues || []).filter(Boolean);
  const scope = options.scope || 'Queue';
  const checkIntervalMs = readPositiveNumber(
    options.checkIntervalMs || process.env.QUEUE_REDIS_WATCHDOG_INTERVAL_MS,
    DEFAULT_CHECK_INTERVAL_MS,
  );
  const unhealthyMs = readPositiveNumber(
    options.unhealthyMs || process.env.QUEUE_REDIS_WATCHDOG_UNHEALTHY_MS,
    DEFAULT_UNHEALTHY_MS,
  );
  const now = options.now || Date.now;
  const setIntervalFn = options.setIntervalFn || setInterval;
  const clearIntervalFn = options.clearIntervalFn || clearInterval;
  const states = new Map();
  const errorHandlers = new Map();
  let stopped = false;
  let checking = false;

  function getState(queue) {
    if (!states.has(queue)) {
      states.set(queue, {
        failedAt: null,
        lastError: null,
        recoveryTriggered: false,
      });
    }
    return states.get(queue);
  }

  function recordFailure(queue, error) {
    if (stopped) {
      return;
    }
    const state = getState(queue);
    const message = error?.message || 'unknown Redis queue error';
    if (state.failedAt === null) {
      state.failedAt = now();
      state.lastError = message;
      logger.warn(`[${scope}] Redis/Bull 队列连接异常`, {
        queue: queue.name,
        message,
      });
    } else {
      state.lastError = message;
    }

    const unhealthyForMs = Math.max(now() - state.failedAt, 0);
    if (unhealthyForMs < unhealthyMs || state.recoveryTriggered) {
      return;
    }

    state.recoveryTriggered = true;
    logger.error(`[${scope}] Redis/Bull 队列持续异常，触发进程恢复`, {
      queue: queue.name,
      unhealthyForMs,
      message,
    });
    if (typeof options.onUnhealthy === 'function') {
      options.onUnhealthy({
        queue,
        message,
        unhealthyForMs,
      });
    }
  }

  function recordSuccess(queue) {
    if (stopped) {
      return;
    }
    const state = getState(queue);
    if (state.failedAt !== null) {
      logger.info(`[${scope}] Redis/Bull 队列连接已恢复`, {
        queue: queue.name,
        unavailableForMs: Math.max(now() - state.failedAt, 0),
      });
    }
    state.failedAt = null;
    state.lastError = null;
    state.recoveryTriggered = false;
  }

  async function runCheck() {
    if (stopped || checking) {
      return;
    }
    checking = true;
    try {
      await Promise.all(
        queueList.map(async (queue) => {
          try {
            await (options.checkQueue || checkQueueConnection)(queue, {
              pingTimeoutMs: options.pingTimeoutMs,
              setTimeoutFn: options.setTimeoutFn,
              checkBacklogProgress: options.checkBacklogProgress,
              activeJobMaxAgeMs: options.activeJobMaxAgeMs,
              now,
            });
            recordSuccess(queue);
          } catch (error) {
            recordFailure(queue, error);
          }
        }),
      );
    } finally {
      checking = false;
    }
  }

  for (const queue of queueList) {
    const handler = (error) => recordFailure(queue, error);
    errorHandlers.set(queue, handler);
    queue.on('error', handler);
  }

  const interval = setIntervalFn(() => {
    void runCheck();
  }, checkIntervalMs);
  if (typeof interval?.unref === 'function') {
    interval.unref();
  }
  if (options.runImmediately !== false) {
    void runCheck();
  }

  return {
    runCheck,
    getState: (queue) => ({ ...getState(queue) }),
    stop() {
      stopped = true;
      clearIntervalFn(interval);
      for (const [queue, handler] of errorHandlers.entries()) {
        queue.removeListener('error', handler);
      }
    },
  };
}

module.exports = {
  DEFAULT_CHECK_INTERVAL_MS,
  DEFAULT_PING_TIMEOUT_MS,
  DEFAULT_UNHEALTHY_MS,
  DEFAULT_ACTIVE_JOB_MAX_AGE_MS,
  checkQueueConnection,
  startQueueConnectionWatchdog,
};
