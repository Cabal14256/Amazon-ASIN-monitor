const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadTaskModule({ request, onMessage = () => () => {} }) {
  const filename = path.join(__dirname, '../src/utils/task.ts');
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  const dependencies = {
    '@/services/websocket': { wsClient: { connect() {}, onMessage } },
    '@umijs/max': { request, history: { push() {} } },
    './debug': { debugError() {} },
  };
  const loadDependency = (name) => {
    if (!Object.hasOwn(dependencies, name))
      throw new Error(`Unexpected import: ${name}`);
    return dependencies[name];
  };
  new Function('module', 'exports', 'require', output)(
    loaded,
    loaded.exports,
    loadDependency,
  );
  return loaded.exports;
}

test('WebSocket completion keeps polling alive until the completed task is returned', async () => {
  global.window = { setTimeout };
  let requests = 0;
  const task = loadTaskModule({
    request: async () => ({
      success: true,
      data: {
        taskId: 'task-1',
        taskType: 'import',
        status: ++requests === 1 ? 'processing' : 'completed',
        result: {
          total: 1,
          processedCount: 1,
          unchangedCount: 1,
          failedCount: 0,
        },
      },
    }),
    onMessage: (listener) => {
      queueMicrotask(() =>
        listener({ type: 'task_complete', taskId: 'task-1' }),
      );
      return () => {};
    },
  });

  const result = await task.waitForTaskResult('task-1', {
    intervalMs: 5,
    timeoutMs: 100,
  });
  assert.equal(result.status, 'completed');
  assert.ok(requests >= 2);
});

test('only a server-confirmed failed task carries a failed status', async () => {
  global.window = { setTimeout };
  const failed = loadTaskModule({
    request: async () => ({
      success: true,
      data: {
        taskId: 'task-2',
        taskType: 'import',
        status: 'failed',
        error: '写入失败',
      },
    }),
  });
  await assert.rejects(
    failed.waitForTaskResult('task-2', { intervalMs: 5, timeoutMs: 20 }),
    (error) => error.message === '写入失败' && error.taskStatus === 'failed',
  );

  const unreachable = loadTaskModule({
    request: async () => {
      throw new Error('网络不可用');
    },
  });
  await assert.rejects(
    unreachable.waitForTaskResult('task-3', { intervalMs: 5, timeoutMs: 20 }),
    (error) => error.message === '网络不可用' && !error.taskStatus,
  );
});
