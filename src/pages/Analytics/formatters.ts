import { toBeijingDayjs } from '@/utils/beijingTime';
import type { ValueMode } from './types';

type LabelValueCarrier = {
  rawValue?: unknown;
  value?: unknown;
};

export const formatTooltipValue = (
  valueMode: ValueMode,
  value: number,
  rawValue?: number,
) => {
  if (valueMode === 'percent') {
    const percent = Number.isNaN(value) ? 0 : value;
    const base = rawValue !== undefined ? ` (${rawValue.toFixed(2)} 小时)` : '';
    return `${percent.toFixed(2)}%${base}`;
  }

  return rawValue !== undefined
    ? `${value.toFixed(2)} 小时${
        rawValue === value ? '' : ` (${rawValue.toFixed(2)} 小时)`
      }`
    : `${value.toFixed(2)} 小时`;
};

export const toNumber = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

export const filterValidValuesByKey = <T, K extends keyof T>(
  data: T[],
  key: K,
) =>
  data.filter((item) => {
    const value = Number(item[key]);
    return Number.isFinite(value) && value > 0;
  });

export const attachLabelValue = <T extends LabelValueCarrier>(
  row: T,
  mode: ValueMode,
): T & { labelValue: string } => ({
  ...row,
  labelValue: formatTooltipValue(
    mode,
    toNumber(row.value),
    toNumber(row.rawValue),
  ),
});

export const parseTimeLabel = (value?: string) => {
  if (!value) {
    return null;
  }

  const parsed = toBeijingDayjs(value);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD HH:mm:ss') : null;
};

export const formatDuration = (durationMs: number) => {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(
      2,
      '0',
    )}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(
    2,
    '0',
  )}`;
};

export const formatHours = (value?: number) =>
  `${toNumber(value).toFixed(2)} 小时`;

export const formatPercent = (value?: number) =>
  `${toNumber(value).toFixed(2)}%`;
