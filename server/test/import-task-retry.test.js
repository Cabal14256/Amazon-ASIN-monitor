const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const servicesDirectory = path.join(__dirname, '../src/services');

function loadWithMocks(filename, mocks) {
  const modulePath = require.resolve(path.join(servicesDirectory, filename));
  const originalLoad = Module._load;
  delete require.cache[modulePath];
  Module._load = function load(request, parent, isMain) {
    if (parent?.filename === modulePath && Object.hasOwn(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[modulePath];
  }
}

function fakeLogger() {
  return { info() {}, warn() {}, error() {} };
}

function loadProcessor(events) {
  const registry = {
    async markTaskProcessing() {
      events.push('processing');
    },
    async updateTaskProgress(_id, _progress, message) {
      events.push(`progress:${message}`);
    },
    async markTaskFailed() {
      events.push('failed');
    },
    async markTaskCompleted() {
      events.push('completed');
    },
    async markTaskCancelled() {
      events.push('cancelled');
    },
  };
  const websocket = {
    sendTaskProgress() {
      events.push('ws-progress');
    },
    sendTaskError() {
      events.push('ws-error');
    },
    sendTaskComplete() {
      events.push('ws-complete');
    },
    sendTaskCancelled() {
      events.push('ws-cancelled');
    },
  };
  return loadWithMocks('importTaskProcessor.js', {
    '../utils/logger': fakeLogger(),
    './websocketService': websocket,
    './taskRegistryService': registry,
    './taskResultService': { normalizeImportTaskResult: (result) => result },
    './taskCancellationService': {
      throwIfTaskCancelled: async () => {},
      isTaskCancelledError: () => false,
    },
    './importService': {
      importFromFile: async () => {
        throw new Error('temporary import failure');
      },
    },
    './incrementalImportService': {
      applyIncrementalImport: async () => {
        throw new Error('temporary import failure');
      },
    },
  });
}

function failedJob(attemptsMade) {
  return {
    data: {
      taskId: 'task-1',
      taskSubType: 'asin',
      fileBuffer: Buffer.from('csv'),
      originalFilename: 'asins.csv',
      userId: 'user-1',
      incremental: true,
    },
    opts: { attempts: 2 },
    attemptsMade,
    progress(value) {
      return value === undefined ? 25 : value;
    },
  };
}

test('processor leaves retryable failure active and marks only final attempt failed', async () => {
  const retryEvents = [];
  const retryProcessor = loadProcessor(retryEvents);
  await assert.rejects(
    retryProcessor.processImportTask(failedJob(0)),
    /temporary import failure/,
  );
  assert.ok(retryEvents.includes('processing'));
  assert.ok(
    retryEvents.some((event) =>
      event.startsWith('progress:导入失败，等待第 2/2 次重试'),
    ),
  );
  assert.ok(retryEvents.includes('ws-progress'));
  assert.ok(!retryEvents.includes('failed'));
  assert.ok(!retryEvents.includes('ws-error'));

  const finalEvents = [];
  const finalProcessor = loadProcessor(finalEvents);
  await assert.rejects(
    finalProcessor.processImportTask(failedJob(1)),
    /temporary import failure/,
  );
  assert.ok(finalEvents.includes('failed'));
  assert.ok(finalEvents.includes('ws-error'));
  assert.ok(
    !finalEvents.some((event) => event.startsWith('progress:导入失败，等待第')),
  );
});

test('Bull failed event emits terminal WebSocket error only after final attempt', async () => {
  class FakeQueue {
    constructor() {
      this.handlers = new Map();
    }
    on(event, callback) {
      this.handlers.set(event, callback);
    }
  }
  const websocketEvents = [];
  const queueModule = loadWithMocks('importTaskQueue.js', {
    bull: FakeQueue,
    '../utils/logger': fakeLogger(),
    './bullQueueSettings': { getBullQueueSettings: () => ({}) },
  });
  const failed = queueModule.queue.handlers.get('failed');
  const originalLoad = Module._load;
  let registryStatus = 'processing';
  const registryEvents = [];
  Module._load = function load(request, parent, isMain) {
    if (
      request === './websocketService' &&
      parent?.filename.endsWith('importTaskQueue.js')
    ) {
      return {
        sendTaskError(_taskId, _message, userId) {
          websocketEvents.push(userId);
        },
      };
    }
    if (
      request === './taskRegistryService' &&
      parent?.filename.endsWith('importTaskQueue.js')
    ) {
      return {
        async readTask() {
          return { status: registryStatus };
        },
        async markTaskFailed() {
          registryStatus = 'failed';
          registryEvents.push('failed');
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    await failed(
      {
        id: 'job-1',
        data: { taskId: 'task-1', userId: 'user-1' },
        opts: { attempts: 2 },
        attemptsMade: 1,
      },
      new Error('temporary'),
    );
    assert.deepEqual(websocketEvents, []);
    assert.deepEqual(registryEvents, []);
    await failed(
      {
        id: 'job-1',
        data: { taskId: 'task-1', userId: 'user-1' },
        opts: { attempts: 2 },
        attemptsMade: 2,
      },
      new Error('final'),
    );
    assert.deepEqual(registryEvents, ['failed']);
    assert.deepEqual(websocketEvents, ['user-1']);
  } finally {
    Module._load = originalLoad;
  }
});
