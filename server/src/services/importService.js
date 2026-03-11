const path = require('path');
const { Worker } = require('worker_threads');
const logger = require('../utils/logger');
const VariantGroup = require('../models/VariantGroup');
const ASIN = require('../models/ASIN');
const CompetitorVariantGroup = require('../models/CompetitorVariantGroup');
const CompetitorASIN = require('../models/CompetitorASIN');
const { parseImportFile } = require('./importParserService');
const { isTaskCancelledError } = require('./taskCancellationService');

const IMPORT_PARSE_WORKER_SCRIPT = path.join(
  __dirname,
  '../workers/import/importParserWorker.js',
);
const IMPORT_PARSE_TIMEOUT_MS =
  Number(process.env.IMPORT_PARSE_TIMEOUT_MS) || 2 * 60 * 1000;
const IMPORT_PARSE_WORKER_ENABLED = !['false', '0', 'no', 'off'].includes(
  String(process.env.IMPORT_PARSE_WORKER_ENABLED || 'true')
    .trim()
    .toLowerCase(),
);
const IMPORT_CANCEL_POLL_INTERVAL_MS =
  Number(process.env.IMPORT_CANCEL_POLL_INTERVAL_MS) || 250;
const IMPORT_CANCEL_CHECK_MIN_INTERVAL_MS =
  Number(process.env.IMPORT_CANCEL_CHECK_MIN_INTERVAL_MS) || 250;

async function runOptionalHook(fn, ...args) {
  if (typeof fn === 'function') {
    await fn(...args);
  }
}

function createCancellationGuard(
  fn,
  minIntervalMs = IMPORT_CANCEL_CHECK_MIN_INTERVAL_MS,
) {
  let lastCheckedAt = 0;

  return async (message) => {
    if (typeof fn !== 'function') {
      return;
    }

    const now = Date.now();
    if (now - lastCheckedAt < minIntervalMs) {
      return;
    }

    lastCheckedAt = now;
    await fn(message);
  };
}

function runImportParseWorker(
  file,
  {
    mode = 'standard',
    checkCancelled,
    timeoutMs = IMPORT_PARSE_TIMEOUT_MS,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const worker = new Worker(IMPORT_PARSE_WORKER_SCRIPT);
    let settled = false;
    let timer = null;
    let cancelInterval = null;
    let cancelCheckRunning = false;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
      }
      if (cancelInterval) {
        clearInterval(cancelInterval);
      }
      worker.terminate().catch(() => {});
    };

    const settleResolve = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };

    const settleReject = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    timer = setTimeout(() => {
      settleReject(new Error(`导入解析超时（${timeoutMs}ms）`));
    }, timeoutMs);

    worker.once('message', (message) => {
      const { requestId: responseId, success, result, error } = message || {};
      if (settled || responseId !== requestId) {
        return;
      }

      if (!success) {
        const workerError = new Error(
          error?.message || error || '导入解析失败',
        );
        if (error?.statusCode) {
          workerError.statusCode = error.statusCode;
        }
        if (error?.code) {
          workerError.code = error.code;
        }
        settleReject(workerError);
        return;
      }

      settleResolve(result);
    });

    worker.once('error', (error) => {
      settleReject(error);
    });

    worker.once('exit', (code) => {
      if (settled || code === 0) {
        return;
      }
      settleReject(new Error(`导入解析 Worker异常退出，code=${code}`));
    });

    if (typeof checkCancelled === 'function') {
      cancelInterval = setInterval(() => {
        if (settled || cancelCheckRunning) {
          return;
        }

        cancelCheckRunning = true;
        Promise.resolve(
          checkCancelled('导入任务已取消（在解析Excel文件时停止）'),
        )
          .then(() => {
            cancelCheckRunning = false;
          })
          .catch((error) => {
            cancelCheckRunning = false;
            settleReject(error);
          });
      }, IMPORT_CANCEL_POLL_INTERVAL_MS);
    }

    worker.postMessage({
      requestId,
      payload: {
        mode,
        file: {
          buffer: file.buffer,
          originalname: file.originalname,
        },
      },
    });
  });
}

async function parseImportPayload(
  file,
  { mode = 'standard', checkCancelled } = {},
) {
  if (!IMPORT_PARSE_WORKER_ENABLED) {
    return parseImportFile(file, { mode });
  }

  return runImportParseWorker(file, {
    mode,
    checkCancelled,
  });
}

async function importFromFile(file, options = {}) {
  const { mode = 'standard', onProgress, checkCancelled } = options;
  const isCompetitor = mode === 'competitor';
  const maybeCheckCancelled = createCancellationGuard(checkCancelled);

  const models = isCompetitor
    ? {
        VariantGroupModel: CompetitorVariantGroup,
        ASINModel: CompetitorASIN,
      }
    : {
        VariantGroupModel: VariantGroup,
        ASINModel: ASIN,
      };

  await runOptionalHook(checkCancelled, '导入任务已取消');
  await runOptionalHook(onProgress, 5, '正在解析Excel文件...');

  let parsedImport;
  const parseStartedAt = Date.now();
  try {
    parsedImport = await parseImportPayload(file, {
      mode,
      checkCancelled,
    });
  } catch (error) {
    if (isTaskCancelledError(error)) {
      logger.info(
        `[导入服务] 解析阶段收到取消请求: ${error.message || '任务已取消'}`,
      );
    } else {
      logger.error(`[导入服务] 解析文件失败: ${error.message || '未知错误'}`);
    }
    throw error;
  }

  const { groupedItems, totalRows, totalDataRows } = parsedImport;
  const errors = parsedImport.errors || [];

  logger.info(
    `[导入服务] Excel解析完成，模式=${mode}，总行数=${totalRows}，数据行=${totalDataRows}，变体组数=${
      groupedItems.length
    }，耗时=${Date.now() - parseStartedAt}ms`,
  );

  await runOptionalHook(checkCancelled, '导入任务已取消');
  await runOptionalHook(onProgress, 50, 'Excel解析完成，正在准备写入...');
  await runOptionalHook(onProgress, 55, '正在写入数据库...');

  let successCount = 0;
  let failedCount = 0;

  for (let groupIndex = 0; groupIndex < groupedItems.length; groupIndex += 1) {
    const groupData = groupedItems[groupIndex];
    await maybeCheckCancelled(
      `导入任务已取消（在处理 ${groupData.name} 前停止）`,
    );

    const groupProgress =
      55 + Math.floor((groupIndex / Math.max(groupedItems.length, 1)) * 35);
    await runOptionalHook(
      onProgress,
      Math.min(groupProgress, 90),
      `正在处理变体组... (${groupIndex + 1}/${groupedItems.length})`,
    );

    try {
      let groupId;
      const existingGroup = await models.VariantGroupModel.findExactMatch({
        name: groupData.name,
        country: groupData.country,
        site: isCompetitor ? undefined : groupData.site,
        brand: groupData.brand,
      });
      await maybeCheckCancelled(
        `导入任务已取消（在处理 ${groupData.name} / ${groupData.country} 时停止）`,
      );

      if (existingGroup) {
        groupId = existingGroup.id;
      } else if (isCompetitor) {
        const newGroup = await models.VariantGroupModel.create({
          name: groupData.name,
          country: groupData.country,
          brand: groupData.brand,
        });
        groupId = newGroup.id;
      } else {
        const newGroup = await models.VariantGroupModel.create({
          name: groupData.name,
          country: groupData.country,
          site: groupData.site,
          brand: groupData.brand,
        });
        groupId = newGroup.id;
      }

      for (
        let asinIndex = 0;
        asinIndex < groupData.asins.length;
        asinIndex += 1
      ) {
        const asinData = groupData.asins[asinIndex];
        await maybeCheckCancelled(
          `导入任务已取消（在处理 ${asinData.asin} 前停止）`,
        );

        try {
          const existingASIN = await models.ASINModel.findByASIN(
            asinData.asin,
            groupData.country,
          );
          await maybeCheckCancelled(
            `导入任务已取消（在处理 ${asinData.asin} 时停止）`,
          );
          if (existingASIN) {
            failedCount += 1;
            errors.push({
              row: 0,
              message: `ASIN ${asinData.asin} 在国家 ${groupData.country} 中已存在，跳过`,
            });
            continue;
          }

          const payload = isCompetitor
            ? {
                asin: asinData.asin,
                name: asinData.name,
                country: groupData.country,
                brand: asinData.brand,
                variantGroupId: groupId,
                asinType: asinData.asinType,
              }
            : {
                asin: asinData.asin,
                name: asinData.name,
                country: groupData.country,
                site: asinData.site,
                brand: asinData.brand,
                variantGroupId: groupId,
                asinType: asinData.asinType,
              };

          await models.ASINModel.create(payload);
          successCount += 1;
        } catch (error) {
          failedCount += 1;
          errors.push({
            row: 0,
            message: `创建ASIN ${asinData.asin} 失败: ${error.message}`,
          });
        }
      }
    } catch (error) {
      failedCount += groupData.asins.length;
      errors.push({
        row: 0,
        message: `创建变体组 ${groupData.name} (${groupData.country}) 失败: ${error.message}`,
      });
    }
  }

  const total = Number(totalDataRows) || 0;
  const processedCount = successCount + failedCount;
  const missingCount = Math.max(total - processedCount, 0);
  const verificationPassed = missingCount === 0;

  if (!verificationPassed) {
    const verificationMessage = `导入结果校验失败：总计 ${total} 条，已处理 ${processedCount} 条，仍有 ${missingCount} 条未归类`;
    errors.push({
      row: 0,
      message: verificationMessage,
    });
    logger.error(`[导入服务] ${verificationMessage}`);
  }

  await runOptionalHook(
    onProgress,
    100,
    verificationPassed ? '导入完成，结果已校验' : '导入完成，但结果校验未通过',
  );

  return {
    total,
    processedCount,
    successCount,
    failedCount,
    missingCount,
    verificationPassed,
    errors: errors.length > 0 ? errors : undefined,
  };
}

module.exports = {
  importFromFile,
};
