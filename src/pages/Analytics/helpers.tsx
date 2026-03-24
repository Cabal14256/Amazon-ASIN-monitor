import { formatBeijingNow } from '@/utils/beijingTime';
import { countryMap } from './constants';

export * from './analyticsResponse';
export * from './constants';
export * from './formatters';
export * from './progressProfile';
export * from './tableColumns';

/**
 * 导出数据为CSV文件
 * @param headers 表头数组 {key: 数据key, label: 显示名称}
 * @param data 数据数组
 * @param filename 文件名（不含扩展名）
 */
export function exportToCSV<T extends Record<string, any>>(
  headers: { key: keyof T | string; label: string }[],
  data: T[],
  filename?: string,
) {
  if (data.length === 0) {
    return;
  }

  // 构建CSV内容
  const headerRow = headers.map((h) => `"${h.label}"`).join(',');
  const dataRows = data.map((row) =>
    headers
      .map((h) => {
        const value = row[h.key as keyof T];
        if (value === undefined || value === null) {
          return '""';
        }
        // 处理包含逗号或引号的值
        const strValue = String(value).replace(/"/g, '""');
        return `"${strValue}"`;
      })
      .join(','),
  );

  const csvContent = [headerRow, ...dataRows].join('\n');

  // 添加BOM以支持中文
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], {
    type: 'text/csv;charset=utf-8;',
  });

  // 下载文件
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  const finalFilename = filename
    ? `${filename}_${formatBeijingNow('YYYY-MM-DD')}.csv`
    : `导出数据_${formatBeijingNow('YYYY-MM-DD')}.csv`;
  link.download = finalFilename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(downloadUrl);
}

/**
 * 格式化时长为CSV导出格式
 */
export const formatHoursForExport = (value?: number) => {
  if (value === undefined || value === null) {
    return '-';
  }
  return `${Number(value).toFixed(2)} 小时`;
};

/**
 * 格式化百分比为CSV导出格式
 */
export const formatPercentForExport = (value?: number) => {
  if (value === undefined || value === null) {
    return '-';
  }
  return `${Number(value).toFixed(2)}%`;
};

/**
 * 获取国家名称
 */
export const getCountryName = (countryCode?: string) => {
  if (!countryCode) {
    return '-';
  }
  return countryMap[countryCode] || countryCode;
};
