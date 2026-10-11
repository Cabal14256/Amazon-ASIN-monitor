const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const processorPath = require.resolve(
  '../src/services/batchDeleteTaskProcessor',
);
const LOCK_TIMEOUT = 'Lock wait timeout exceeded; try restarting transaction';

function successfulChunk() {
  return {
    totalRequested: 1,
    deletedGroupCount: 1,
    deletedDirectAsinCount: 0,
    deletedNestedAsinCount: 1,
    skipped: { groupIds: [], asinIds: [] },
  };
}

function createHarness(outcomes) {
  const calls = {
    completed: [],
    failed: [],
    progress: [],
    websocketComplete: [],
    websocketError: [],
    cacheClear: [],
  };
  const chunks = outcomes.map((_, index) => ({
    groupIds: [`group-${index + 1}`],
    asinIds: [],
  }));
  const analysis = {
    totalRequested: chunks.length,
    groupIds: chunks.flatMap((chunk) => chunk.groupIds),
    directAsinIds: [],
    deletedNestedAsinCount: chunks.length,
    skipped: { groupIds: [], asinIds: [] },
  };
  let nextChunk = 0;

  const registry = {
    async markTaskProcessing() {},
    async updateTaskProgress() {},
    async markTaskCompleted(...args) {
      calls.completed.push(args);
    },
    async markTaskFailed(...args) {
      calls.failed.push(args);
    },
  };
  const batchDeleteService = {
    async analyzeBatchDelete() {
      return analysis;
    },
    splitPlanIntoChunks() {
      return chunks;
    },
    createEmptyAggregateResult(totalRequested) {
      return {
        mode: 'async',
        totalRequested,
        deletedGroupCount: 0,
        deletedDirectAsinCount: 0,
        deletedNestedAsinCount: 0,
        skipped: { groupIds: new Set(), asinIds: new Set() },
        failedCount: 0,
        failedSamples: [],
      };
    },
    addDeleteResult(aggregate, result) {
      aggregate.totalRequested += result.totalRequested || 0;
      aggregate.deletedGroupCount += result.deletedGroupCount || 0;
      aggregate.deletedDirectAsinCount += result.deletedDirectAsinCount || 0;
      aggregate.deletedNestedAsinCount += result.deletedNestedAsinCount || 0;
    },
    finalizeAggregateResult(aggregate) {
      return {
        ...aggregate,
        skipped: { groupIds: [], asinIds: [] },
        skippedCount: 0,
      };
    },
    async executeBatchDelete() {
      const outcome = outcomes[nextChunk++];
      if (outcome instanceof Error) {
        throw outcome;
      }
      return outcome;
    },
    clearBatchDeleteCache(domain) {
      calls.cacheClear.push(domain);
    },
  };
  const stubs = {
    '../utils/logger': { info() {}, warn() {}, error() {} },
    './websocketService': {
      sendTaskProgress() {},
      sendTaskComplete(...args) {
        calls.websocketComplete.push(args);
      },
      sendTaskError(...args) {
        calls.websocketError.push(args);
      },
    },
    './taskRegistryService': registry,
    './taskCancellationService': {
      async throwIfTaskCancelled() {},
      isTaskCancelledError() {
        return false;
      },
    },
    './batchDeleteService': batchDeleteService,
    './taskResultService': {
      normalizeBatchDeleteTaskResult(result) {
        return {
          ...result,
          verificationPassed: result.failedCount === 0,
        };
      },
    },
  };

  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (
      parent?.filename === processorPath &&
      Object.prototype.hasOwnProperty.call(stubs, request)
    ) {
      return stubs[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  let processor;
  try {
    delete require.cache[processorPath];
    processor = require(processorPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[processorPath];
  }

  const job = {
    data: {
      taskId: 'test-batch-delete',
      domain: 'asin',
      groupIds: analysis.groupIds,
      asinIds: [],
      userId: 'test-user',
    },
    progress(value) {
      calls.progress.push(value);
    },
  };

  return { calls, job, process: processor.processBatchDeleteTask };
}

test('all failed chunks reject and retain their result without a success signal', async () => {
  const harness = createHarness([
    new Error(LOCK_TIMEOUT),
    new Error(LOCK_TIMEOUT),
  ]);

  await assert.rejects(() => harness.process(harness.job), /2\/2/);

  assert.equal(harness.calls.failed.length, 1);
  assert.equal(harness.calls.completed.length, 0);
  assert.equal(harness.calls.websocketError.length, 1);
  assert.equal(harness.calls.websocketComplete.length, 0);
  assert.equal(harness.calls.progress.includes(100), false);
  assert.deepEqual(harness.calls.cacheClear, ['asin']);

  const [taskId, message, patch] = harness.calls.failed[0];
  assert.equal(taskId, 'test-batch-delete');
  assert.match(message, /2\/2/);
  assert.equal(patch.result.failedCount, 2);
  assert.equal(patch.result.verificationPassed, false);
  assert.equal(patch.result.deletedGroupCount, 0);
  assert.equal(patch.result.failedSamples.length, 2);
  assert.equal(patch.result.failedSamples[0].error, LOCK_TIMEOUT);
});

test('partial failure rejects while preserving committed chunk counts', async () => {
  const harness = createHarness([successfulChunk(), new Error(LOCK_TIMEOUT)]);

  await assert.rejects(() => harness.process(harness.job), /1\/2/);

  assert.equal(harness.calls.failed.length, 1);
  assert.equal(harness.calls.completed.length, 0);
  assert.equal(harness.calls.progress.includes(100), false);
  assert.deepEqual(harness.calls.cacheClear, ['asin']);

  const result = harness.calls.failed[0][2].result;
  assert.equal(result.failedCount, 1);
  assert.equal(result.verificationPassed, false);
  assert.equal(result.deletedGroupCount, 1);
  assert.equal(result.deletedNestedAsinCount, 1);
  assert.equal(result.failedSamples[0].error, LOCK_TIMEOUT);
});

test('all successful chunks complete normally', async () => {
  const harness = createHarness([successfulChunk(), successfulChunk()]);

  const result = await harness.process(harness.job);

  assert.equal(result.failedCount, 0);
  assert.equal(result.verificationPassed, true);
  assert.equal(result.deletedGroupCount, 2);
  assert.equal(harness.calls.completed.length, 1);
  assert.equal(harness.calls.failed.length, 0);
  assert.equal(harness.calls.websocketComplete.length, 1);
  assert.equal(harness.calls.websocketError.length, 0);
  assert.equal(harness.calls.progress.at(-1), 100);
  assert.deepEqual(harness.calls.cacheClear, ['asin']);
});
