const ExcelJS = require('exceljs');
const path = require('path');
const { Readable } = require('stream');

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

function repairHeaderText(value) {
  let header = String(value || '').trim();
  if (header.includes('±ä') || header.includes('Ìå') || header.includes('×é')) {
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
    if (
      (header.includes('类型') && header.includes('ASIN')) ||
      header === 'ASIN类型'
    ) {
      return true;
    }
    if (
      header.includes('类型') &&
      !header.includes('组') &&
      !header.includes('变体组')
    ) {
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
  let fileBuffer = file.buffer;

  if (!Buffer.isBuffer(fileBuffer)) {
    fileBuffer = Buffer.from(fileBuffer || []);
  }

  if (ext === '.csv') {
    let csvBuffer = fileBuffer;
    if (
      csvBuffer.length >= 3 &&
      csvBuffer[0] === 0xef &&
      csvBuffer[1] === 0xbb &&
      csvBuffer[2] === 0xbf
    ) {
      csvBuffer = csvBuffer.slice(3);
    }
    if (
      csvBuffer.length >= 2 &&
      csvBuffer[0] === 0xff &&
      csvBuffer[1] === 0xfe
    ) {
      csvBuffer = csvBuffer.slice(2);
    }
    if (
      csvBuffer.length >= 2 &&
      csvBuffer[0] === 0xfe &&
      csvBuffer[1] === 0xff
    ) {
      csvBuffer = csvBuffer.slice(2);
    }
    const stream = Readable.from(csvBuffer);
    await workbook.csv.read(stream);
  } else if (ext === '.xlsx') {
    await workbook.xlsx.load(fileBuffer);
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

async function parseImportFile(file, options = {}) {
  const { mode = 'standard' } = options;
  const isCompetitor = mode === 'competitor';

  const workbook = await parseWorkbook(file);
  const worksheet = workbook.worksheets[0];
  const data = worksheetToRows(worksheet);

  if (data.length < 2) {
    const error = new Error('Excel文件至少需要包含表头和数据行');
    error.statusCode = 400;
    throw error;
  }

  const headers = data[0].map(repairHeaderText);
  const indexes = findColumnIndexes(headers, { withSite: !isCompetitor });

  const missingColumns = [];
  if (indexes.groupNameIndex === -1) missingColumns.push('变体组名称');
  if (indexes.countryIndex === -1) missingColumns.push('国家');
  if (indexes.asinIndex === -1) missingColumns.push('ASIN');
  if (indexes.brandIndex === -1) missingColumns.push('品牌');
  if (!isCompetitor && indexes.siteIndex === -1) missingColumns.push('站点');

  if (missingColumns.length > 0) {
    const error = new Error(
      `Excel文件必须包含：${missingColumns.join(
        '、',
      )}列。当前表头：${headers.join(', ')}`,
    );
    error.statusCode = 400;
    throw error;
  }

  const groupMap = new Map();
  const errors = [];
  const totalDataRows = data.length - 1;

  for (let index = 1; index < data.length; index += 1) {
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
    const asin = String(row[indexes.asinIndex] || '')
      .trim()
      .toUpperCase();
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

    const groupKey = isCompetitor
      ? `${groupName}__${country}__${brand}`
      : `${groupName}__${country}__${site}__${brand}`;
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

  return {
    totalRows: data.length,
    totalDataRows,
    headers,
    indexes,
    groupedItems: Array.from(groupMap.values()),
    errors,
  };
}

module.exports = {
  parseImportFile,
};
