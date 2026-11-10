const DEFAULT_HTTP_REQUEST_TIMEOUT_MS = 60 * 1000;

function getHttpRequestTimeoutMs(
  value = process.env.SP_API_REQUEST_TIMEOUT_MS,
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_HTTP_REQUEST_TIMEOUT_MS;
  }
  return Math.floor(parsed);
}

/**
 * Adds a total timeout to a Node.js ClientRequest.
 * The caller owns rejection and should destroy the request in onTimeout.
 */
function attachHttpRequestTimeout(
  request,
  { timeoutMs = getHttpRequestTimeoutMs(), label = 'HTTP request', onTimeout },
) {
  if (!request || typeof onTimeout !== 'function') {
    return () => {};
  }

  const duration = getHttpRequestTimeoutMs(timeoutMs);
  let active = true;
  const timer = setTimeout(() => {
    if (!active) {
      return;
    }
    active = false;
    const error = new Error(`${label} timed out after ${duration}ms`);
    error.code = 'ETIMEDOUT';
    onTimeout(error);
  }, duration);
  timer.unref?.();

  if (typeof request.setTimeout === 'function') {
    request.setTimeout(duration, () => {
      if (!active) {
        return;
      }
      active = false;
      const error = new Error(`${label} timed out after ${duration}ms`);
      error.code = 'ETIMEDOUT';
      onTimeout(error);
    });
  }

  return () => {
    if (!active) {
      return;
    }
    active = false;
    clearTimeout(timer);
    if (typeof request.setTimeout === 'function') {
      request.setTimeout(0);
    }
  };
}

module.exports = {
  DEFAULT_HTTP_REQUEST_TIMEOUT_MS,
  getHttpRequestTimeoutMs,
  attachHttpRequestTimeout,
};
