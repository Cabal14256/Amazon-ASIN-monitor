const ExcelJS = require('exceljs');
const path = require('path');
const { Readable } = require('stream');
const logger = require('../utils/logger');
const VariantGroup = require('../models/VariantGroup');
const ASIN = require('../models/ASIN');
const CompetitorVariantGroup = require('../models/CompetitorVariantGroup');
const CompetitorASIN = require('../models/CompetitorASIN');

const VALID_COUNTRIES = ['US', 'UK', 'DE', 'FR', 'IT', 'ES'];

function worksheetToRows(worksheet) {
  const rows = [];
  let maxCol = 0;

  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const length = Math.max(row.values.length - 1, row.cellCount);
    if (length > maxCol) {
      maxCol = length;
    }
  });

  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const rowData = [];
    for (let col = 1; col <= maxCol; col += 1) {
      const cell = row.getCell(col);
      rowData.push(cell?.text ?? '');
    }
    rows.push(rowData);
  });

  return rows;
}

async function runOptionalHook(fn, ...args) {
  if (typeof fn === 'function') {
    await fn(...args);
  }
}

function repairHeaderText(value) {
  let header = String(value || '').trim();
  if (
    header.includes('±ä') ||
    header.includes('Ìå') ||
    header.includes('×é')
  ) {
    try {
      header = Buffer.from(header, 'latin1').toString('utf8');
    } catch (error) {
      // noop
    }
  }
  return header;
}

function findColumnIndexes(headers, { withSite }) {
  const groupNameIndex = headers.findIndex((header, index) => {
    const lower = header.toLowerCase();
    return (
      header.includes('变体组') ||
      header.includes('组名称') ||
      header === '变体组名称' ||
      header.includes('变体') ||
      header.includes('组') ||
      lower.includes('group') ||
      lower.includes('variant') ||
      (index === 0 && header.length > 0)
    );
  });

  const countryIndex = headers.findIndex((header, index) => {
    const lower = header.toLowerCase();
    return (
      header.includes('国家') ||
      header === '国家' ||
      header.includes('国') ||
      lower.includes('country') ||
      lower === 'country' ||
      (index === 1 && header.length > 0 && header.length < 10)
    );
  });

  const siteIndex = withSite
    ? headers.findIndex((header, index) => {
        const lower = header.toLowerCase();
        return (
          header.includes('站点') ||
          header === '站点' ||
          header.includes('站') ||
          lower.includes('site') ||
          (index === 2 && header.length > 0 && header.length < 20)
        );
      })
    : -1;

  const brandIndex = headers.findIndex((header, index) => {
    const lower = header.toLowerCase();
    return (
      header.includes('品牌') ||
      header === '品牌' ||
      header.includes('品') ||
      lower.includes('brand') ||
      (index === (withSite ? 3 : 2) && header.length > 0 && header.length < 50)
    );
  });

  const asinIndex = headers.findIndex((header, index) => {
    const lower = header.toLowerCase();
    return (
      header.includes('ASIN') ||
      header === 'asin' ||
      lower === 'asin' ||
      lower.includes('asin') ||
      (index >= (withSite ? 4 : 3) &&
        header.length > 0 &&
        /^[A-Z0-9]+$/i.test(header))
    );
  });

  const asinNameIndex = headers.findIndex((header) => {
    const lower = header.toLowerCase();
    return (
      (header.includes('名称') && header.includes('ASIN')) ||
      header === 'ASIN名称' ||
      (header.includes('名称') &&
        !header.includes('组') &&
        !header.includes('变体组')) ||
      (lower.includes('asin') && lower.includes('name')) ||
      (lower.includes('name') &&
        !lower.includes('group') &&
        !lower.includes('variant'))
    );
  });

  const asinTypeIndex = headers.findIndex((header, index) => {
    const lower = header.toLowerCase();
    if ((header.includes('类型') && header.includes('ASIN')) || header === 'ASIN类型') {
      return true;
    }
    if (header.includes('类型') && !header.includes('组') && !header.includes('变体组')) {
      return true;
    }
    if (
      (lower.includes('asin') && lower.includes('type')) ||
      (lower.includes('type') && !lower.includes('variant'))
    ) {
      return true;
    }
    if (asinIndex !== -1 && index > asinIndex && index >= headers.length - 2) {
      return true;
    }
    return false;
  });

  return {
    groupNameIndex,
    countryIndex,
    siteIndex,
    brandIndex,
    asinIndex,
    asinNameIndex,
    asinTypeIndex,
  };
}

function normalizeAsinType(value) {
  if (!value) {
    return null;
  }
  const normalized = String(value).trim();
  if (normalized === '1') {
    return '1';
  }
  if (normalized === '2') {
    return '2';
  }
  return null;
}

async function parseWorkbook(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const workbook = new ExcelJS.Workbook();

  if (ext === '.csv') {
    let buffer = file.buffer;
    if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      buffer = buffer.slice(3);
    }
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      buffer = buffer.slice(2);
    }
    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
      buffer = buffer.slice(2);
    }
    const stream = Readable.from(buffer);
    await workbook.csv.read(stream);
  } else if (ext === '.xlsx') {
    await workbook.xlsx.load(file.buffer);
  } else {
    const error = new Error('仅支持 .xlsx 或 .csv 格式');
    error.statusCode = 400;
    throw error;
  }

  if (!workbook.worksheets || workbook.worksheets.length === 0) {
    const error = new Error('Excel文件不包含任何工作表');
    error.statusCode = 400;
    throw error;
  }

  return workbook;
}

async function importFromFile(file, options = {}) {
  const { mode = 'standard', onProgress, checkCancelled } = options;
  const isCompetitor = mode === 'competitor';

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

  let workbook;
  try {
    workbook = await parseWorkbook(file);
  } catch (error) {
    logger.error('[导入服务] 解析文件失败:', error);
    throw error;
  }

  const worksheet = workbook.worksheets[0];
  const data = worksheetToRows(worksheet);

  logger.info(`[导入服务] 解析到 ${data.length} 行数据，模式=${mode}`);

  if (data.length < 2) {
    const error = new Error('Excel文件至少需要包含表头和数据行');
    error.statusCode = 400;
    throw error;
  }

  await runOptionalHook(checkCancelled, '导入任务已取消');
  await runOptionalHook(onProgress, 15, '正在识别表头...');

  const headers = data[0].map(repairHeaderText);
  const indexes = findColumnIndexes(headers, { withSite: !isCompetitor });

  logger.info('[导入服务] 表头索引:', { mode, ...indexes });

  const missingColumns = [];
  if (indexes.groupNameIndex === -1) missingColumns.push('变体组名称');
  if (indexes.countryIndex === -1) missingColumns.push('国家');
  if (indexes.asinIndex === -1) missingColumns.push('ASIN');
  if (indexes.brandIndex === -1) missingColumns.push('品牌');
  if (!isCompetitor && indexes.siteIndex === -1) missingColumns.push('站点');

  if (missingColumns.length > 0) {
    const error = new Error(
      `Excel文件必须包含：${missingColumns.join('、')}列。当前表头：${headers.join(', ')}`,
    );
    error.statusCode = 400;
    throw error;
  }

  const groupMap = new Map();
  const errors = [];
  const totalDataRows = data.length - 1;

  for (let index = 1; index < data.length; index += 1) {
    if ((index - 1) % 50 === 0) {
      await runOptionalHook(checkCancelled, '导入任务已取消');
      const rowProgress = 20 + Math.floor(((index - 1) / totalDataRows) * 30);
      await runOptionalHook(
        onProgress,
        Math.min(rowProgress, 50),
        `正在校验数据... (${index - 1}/${totalDataRows})`,
      );
    }

    const rowNumber = index + 1;
    const row = data[index];
    if (!row || row.length === 0) {
      continue;
    }

    const groupName = String(row[indexes.groupNameIndex] || '').trim();
    const country = String(row[indexes.countryIndex] || '')
      .trim()
      .toUpperCase();
    const site = isCompetitor
      ? ''
      : String(row[indexes.siteIndex] || '').trim();
    const brand = String(row[indexes.brandIndex] || '').trim();
    const asin = String(row[indexes.asinIndex] || '').trim();
    const asinName =
      indexes.asinNameIndex !== -1
        ? String(row[indexes.asinNameIndex] || '').trim() || null
        : null;
    const asinType =
      indexes.asinTypeIndex !== -1
        ? String(row[indexes.asinTypeIndex] || '').trim()
        : '';

    if (!groupName) {
      errors.push({ row: rowNumber, message: '变体组名称不能为空' });
      continue;
    }

    if (!country || !VALID_COUNTRIES.includes(country)) {
      errors.push({
        row: rowNumber,
        message: `国家代码无效: ${country}，必须是 US/UK/DE/FR/IT/ES 之一`,
      });
      continue;
    }

    if (!brand) {
      errors.push({ row: rowNumber, message: '品牌不能为空' });
      continue;
    }

    if (!isCompetitor && !site) {
      errors.push({ row: rowNumber, message: '站点（店铺代号）不能为空' });
      continue;
    }

    if (!asin) {
      errors.push({ row: rowNumber, message: 'ASIN不能为空' });
      continue;
    }

    if (asinType && !['1', '2'].includes(String(asinType).trim())) {
      errors.push({
        row: rowNumber,
        message: `ASIN类型无效: ${asinType}，必须是 1（主链）或 2（副评）`,
      });
      continue;
    }

    const groupKey = `${groupName}_${country}`;
    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, {
        name: groupName,
        country,
        site,
        brand,
        asins: [],
      });
    }

    const group = groupMap.get(groupKey);
    if (!group.asins.find((item) => item.asin === asin)) {
      group.asins.push({
        asin,
        name: asinName || null,
        asinType: normalizeAsinType(asinType),
        site,
        brand,
      });
    }
  }

  await runOptionalHook(onProgress, 55, '正在写入数据库...');

  let successCount = 0;
  let failedCount = 0;
  const groupedItems = Array.from(groupMap.values());

  for (let groupIndex = 0; groupIndex < groupedItems.length; groupIndex += 1) {
    const groupData = groupedItems[groupIndex];
    await runOptionalHook(
      checkCancelled,
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
      const existingGroups = await models.VariantGroupModel.findAll({
        keyword: groupData.name,
        country: groupData.country,
        current: 1,
        pageSize: 1,
      });

      let groupId;
      if (existingGroups.list && existingGroups.list.length > 0) {
        groupId = existingGroups.list[0].id;
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

      for (let asinIndex = 0; asinIndex < groupData.asins.length; asinIndex += 1) {
        const asinData = groupData.asins[asinIndex];
        if (asinIndex % 10 === 0) {
          await runOptionalHook(
            checkCancelled,
            `导入任务已取消（在处理 ${asinData.asin} 前停止）`,
          );
        }

        try {
          const existingASIN = await models.ASINModel.findByASIN(
            asinData.asin,
            groupData.country,
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

  await runOptionalHook(onProgress, 100, '导入完成');

  return {
    total: successCount + failedCount,
    successCount,
    failedCount,
    errors: errors.length > 0 ? errors : undefined,
  };
}

module.exports = {
  importFromFile,
};
