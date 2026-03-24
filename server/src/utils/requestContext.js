const { AsyncLocalStorage } = require('async_hooks');

const requestContextStorage = new AsyncLocalStorage();

class RequestCancelledError extends Error {
  constructor(message = '请求已取消', reason = 'cancelled') {
    super(message);
    this.name = 'RequestCancelledError';
    this.code = 'REQUEST_CANCELLED';
    this.statusCode = 499;
    this.reason = reason;
  }
}

function createRequestContext() {
  return {
    cancelled: false,
    cancelReason: '',
    createdAt: Date.now(),
  };
}

function runWithRequestContext(context, callback) {
  return requestContextStorage.run(context, callback);
}

function getRequestContext() {
  return requestContextStorage.getStore() || null;
}

function cancelRequestContext(context, reason = 'cancelled') {
  if (!context || context.cancelled) {
    return;
  }

  context.cancelled = true;
  context.cancelReason = reason;
  context.cancelledAt = Date.now();
}

function isRequestCancelled(context = getRequestContext()) {
  return Boolean(context?.cancelled);
}

function throwIfRequestCancelled(context = getRequestContext()) {
  if (!isRequestCancelled(context)) {
    return;
  }

  throw new RequestCancelledError(
    context?.cancelReason === 'timeout' ? '请求已超时取消' : '请求已取消',
    context?.cancelReason || 'cancelled',
  );
}

function requestContextMiddleware(req, res, next) {
  const context = createRequestContext();
  req.requestContext = context;

  runWithRequestContext(context, () => {
    res.on('close', () => {
      if (!res.writableEnded) {
        cancelRequestContext(context, 'connection_closed');
      }
    });

    next();
  });
}

module.exports = {
  RequestCancelledError,
  cancelRequestContext,
  createRequestContext,
  getRequestContext,
  isRequestCancelled,
  requestContextMiddleware,
  runWithRequestContext,
  throwIfRequestCancelled,
};
