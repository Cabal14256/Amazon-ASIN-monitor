const ExcelJS = require('exceljs');
const path = require('path');
const { Readable } = require('stream');
const iconv = require('iconv-lite');

const VALID_COUNTRIES = ['US', 'UK', 'DE', 'FR', 'IT', 'ES'];
const HEADER_KEYWORDS = [
  '国家',
  '站点',
  '品牌',
  '变体组',
  '组名称',
  '名称',
  '类型',
  'ASIN',
  'asin',
  'country',
  'site',
  'brand',
  'group',
  'variant',
  'type',
];

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

function scoreHeaderText(text) {
  const firstLine = String(text || '').split(/\r?\n/, 1)[0];
  const normalizedFirstLine = firstLine.toLowerCase();
  return HEADER_KEYWORDS.reduce(
    (score, keyword) =>
      score + (normalizedFirstLine.includes(keyword.toLowerCase()) ? 1 : 0),
    0,
  );
}

function normalizeCsvBuffer(buffer) {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    return buffer.slice(3);
  }

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return Buffer.from(iconv.decode(buffer.slice(2), 'utf16-le'), 'utf8');
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return Buffer.from(iconv.decode(buffer.slice(2), 'utf16-be'), 'utf8');
  }

  const utf8Text = buffer.toString('utf8');
  const gb18030Text = iconv.decode(buffer, 'gb18030');
  const utf8Score = scoreHeaderText(utf8Text);
  const gb18030Score = scoreHeaderText(gb18030Text);

  if (gb18030Score > utf8Score) {
    return Buffer.from(gb18030Text, 'utf8');
  }

  return buffer;
}

function findColumnIndex(headers, semanticMatcher) {
  return headers.findIndex((header, index) =>
    semanticMatcher(header, header.toLowerCase(), index),
  );
}

function isGroupNameHeader(header, lower) {
  return (
    header.includes('变体组') ||
    header.includes('组名称') ||
    header.includes('变体') ||
    header.includes('组') ||
    lower.includes('group') ||
    lower.includes('variant')
  );
}

function isCountryHeader(header, lower) {
  return (
    header.includes('国家') ||
    header === '国家' ||
    header.includes('国') ||
    lower.includes('country') ||
    lower === 'country'
  );
}

function isSiteHeader(header, lower) {
  return (
    header.includes('站点') ||
    header === '站点' ||
    header.includes('站') ||
    lower.includes('site')
  );
}

function isBrandHeader(header, lower) {
  return (
    header.includes('品牌') ||
    header === '品牌' ||
    header.includes('品') ||
    lower.includes('brand')
  );
}

function isAsinNameHeader(header, lower) {
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
}

function isAsinTypeHeader(header, lower) {
  return (
    (header.includes('类型') && header.includes('ASIN')) ||
    header === 'ASIN类型' ||
    (header.includes('类型') &&
      !header.includes('组') &&
      !header.includes('变体组')) ||
    (lower.includes('asin') && lower.includes('type')) ||
    (lower.includes('type') && !lower.includes('variant'))
  );
}

function isAsinValueHeader(header, lower) {
  if (isAsinTypeHeader(header, lower) || isAsinNameHeader(header, lower)) {
    return false;
  }

  return (
    header.includes('ASIN') ||
    header === 'asin' ||
    lower === 'asin' ||
    lower.includes('asin')
  );
}

function findColumnIndexes(headers, { withSite }) {
  const groupNameIndex = findColumnIndex(headers, isGroupNameHeader);

  const countryIndex = findColumnIndex(headers, isCountryHeader);

  const siteIndex = withSite ? findColumnIndex(headers, isSiteHeader) : -1;

  const brandIndex = findColumnIndex(headers, isBrandHeader);

  const asinNameIndex = headers.findIndex((header) =>
    isAsinNameHeader(header, header.toLowerCase()),
  );

  const asinIndex = findColumnIndex(headers, isAsinValueHeader);

  const asinTypeIndex = findColumnIndex(headers, isAsinTypeHeader);

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
    const csvBuffer = normalizeCsvBuffer(fileBuffer);
    const stream = Readable.from([csvBuffer]);
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
