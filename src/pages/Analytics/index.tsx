import LazyECharts from '@/components/LazyECharts';
import services from '@/services/asin';
import opsServices from '@/services/ops';
import { formatBeijing, toBeijingDayjs } from '@/utils/beijingTime';
import { exportToExcel } from '@/utils/export';
import { useMessage } from '@/utils/message';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { PageContainer, StatisticCard } from '@ant-design/pro-components';
import { history, useAccess } from '@umijs/max';
import {
  Button,
  Card,
  Col,
  DatePicker,
  Input,
  Progress,
  Radio,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import { type Dayjs } from 'dayjs';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const { RangePicker } = DatePicker;
const {
  getStatisticsByTime,
  getAnalyticsPeakMarkAreas,
  getMonitorStatistics,
  getPeakHoursStatistics,
  getAllCountriesSummary,
  getRegionSummary,
  getPeriodSummary,
  getASINStatisticsByCountry,
  getASINStatisticsByVariantGroup,
} = services.MonitorController;
const { clearAnalyticsCache, refreshAnalyticsAgg } = opsServices.OpsController;

// 国家选项映射
const countryMap: Record<string, string> = {
  US: '美国',
  EU: '欧洲汇总',
  UK: '英国',
  DE: '德国',
  FR: '法国',
  IT: '意大利',
  ES: '西班牙',
};

// 高峰期区域名称映射
const peakAreaNameMap: Record<string, string> = {
  US: 'US（美国）',
  UK: 'UK（英国）',
  EU_OTHER: 'DE/FR/ES/IT（其他EU国家）',
};

const formatTooltipValue = (
  valueMode: 'count' | 'percent',
  value: number,
  rawValue?: number,
) => {
  if (valueMode === 'percent') {
    const percent = isNaN(value) ? 0 : value;
    const base = rawValue !== undefined ? ` (${rawValue.toFixed(2)} 小时)` : '';
    return `${percent.toFixed(2)}%${base}`;
  }
  return rawValue !== undefined
    ? `${value.toFixed(2)} 小时${
        rawValue === value ? '' : ` (${rawValue.toFixed(2)} 小时)`
      }`
    : `${value.toFixed(2)} 小时`;
};

const toNumber = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const filterValidValuesByKey = <T, K extends keyof T>(data: T[], key: K) =>
  data.filter((item) => {
    const value = Number(item[key]);
    return Number.isFinite(value) && value > 0;
  });

const attachLabelValue = (row: any, mode: 'count' | 'percent') => ({
  ...row,
  labelValue: formatTooltipValue(
    mode,
    toNumber(row.value),
    toNumber(row.rawValue),
  ),
});

const parseTimeLabel = (value?: string) => {
  if (!value) {
    return null;
  }
  const parsed = toBeijingDayjs(value);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD HH:mm:ss') : null;
};

const formatDuration = (durationMs: number) => {
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

const formatHours = (value?: number) => `${toNumber(value).toFixed(2)} 小时`;
const formatPercent = (value?: number) => `${toNumber(value).toFixed(2)}%`;

const durationSummaryMetricCopy = {
  ratioAllTime: {
    label: '整体异常时长占比',
    tooltip: '异常时长 / 总监控时长，反映整体异常程度。',
  },
  globalPeakRate: {
    label: '高峰异常时长占总时长',
    tooltip: '高峰时段异常时长 / 总监控时长，分母是全部监控时长。',
  },
  globalLowRate: {
    label: '低峰异常时长占总时长',
    tooltip: '低峰时段异常时长 / 总监控时长，分母是全部监控时长。',
  },
  ratioHigh: {
    label: '高峰时段内异常占比',
    tooltip: '高峰时段异常时长 / 高峰时段总监控时长，只看高峰时段内部。',
  },
  ratioLow: {
    label: '低峰时段内异常占比',
    tooltip: '低峰时段异常时长 / 低峰时段总监控时长，只看低峰时段内部。',
  },
} as const;

type DurationSummaryMetricKey = keyof typeof durationSummaryMetricCopy;

const renderDurationSummaryMetricTitle = (key: DurationSummaryMetricKey) => {
  const metric = durationSummaryMetricCopy[key];

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span>{metric.label}</span>
      <Tooltip title={metric.tooltip}>
        <QuestionCircleOutlined
          style={{ color: 'rgba(0, 0, 0, 0.45)', fontSize: 12 }}
        />
      </Tooltip>
    </span>
  );
};

const durationSummaryRateColumns = [
  {
    title: renderDurationSummaryMetricTitle('ratioAllTime'),
    dataIndex: 'ratioAllTime',
    key: 'ratioAllTime',
    align: 'right' as const,
    render: (value?: number) => formatPercent(value),
  },
  {
    title: renderDurationSummaryMetricTitle('globalPeakRate'),
    dataIndex: 'globalPeakRate',
    key: 'globalPeakRate',
    align: 'right' as const,
    render: (value?: number) => formatPercent(value),
  },
  {
    title: renderDurationSummaryMetricTitle('globalLowRate'),
    dataIndex: 'globalLowRate',
    key: 'globalLowRate',
    align: 'right' as const,
    render: (value?: number) => formatPercent(value),
  },
  {
    title: renderDurationSummaryMetricTitle('ratioHigh'),
    dataIndex: 'ratioHigh',
    key: 'ratioHigh',
    align: 'right' as const,
    render: (value?: number) => formatPercent(value),
  },
  {
    title: renderDurationSummaryMetricTitle('ratioLow'),
    dataIndex: 'ratioLow',
    key: 'ratioLow',
    align: 'right' as const,
    render: (value?: number) => formatPercent(value),
  },
];

type ProgressProfile = Record<
  string,
  {
    avgDurationMs?: number;
    avgPerItemMs?: number;
    lastTotal?: number;
  }
>;

const normalizePeriodSummaryResponse = (
  result: any,
  fallbackCurrent: number,
  fallbackPageSize: number,
) => {
  const fallback = {
    list: [] as API.PeriodSummary[],
    total: 0,
    current: fallbackCurrent,
    pageSize: fallbackPageSize,
  };

  if (!result || typeof result !== 'object') {
    return fallback;
  }

  const payload =
    'success' in result
      ? result.success
        ? result.data
        : null
      : result.data || result;

  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.list)) {
    return fallback;
  }

  return {
    list: payload.list,
    total: Number(payload.total) || 0,
    current: Number(payload.current) || fallbackCurrent,
    pageSize: Number(payload.pageSize) || fallbackPageSize,
  };
};

const PROGRESS_PROFILE_KEY = 'analyticsProgressProfile.v1';

const readProgressProfile = (): ProgressProfile => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(PROGRESS_PROFILE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return parsed as ProgressProfile;
  } catch {
    return {};
  }
};

const writeProgressProfile = (profile: ProgressProfile) => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(PROGRESS_PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // 忽略写入失败
  }
};

type PeakMarkArea = {
  areas: any[];
  color: string;
  name: string;
};

const unwrapAnalyticsResponse = <T,>(
  result: any,
  fallback: T,
): {
  data: T;
  meta?: API.AnalyticsResponseMeta;
} => {
  if (result && typeof result === 'object' && 'success' in result) {
    return {
      data: (result.data ?? fallback) as T,
      meta: result.meta as API.AnalyticsResponseMeta | undefined,
    };
  }

  return {
    data: (result?.data ?? result ?? fallback) as T,
    meta: result?.meta as API.AnalyticsResponseMeta | undefined,
  };
};

const AnalyticsPageContent: React.FC<unknown> = () => {
  const access = useAccess();
  const message = useMessage();
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    toBeijingDayjs().startOf('day'),
    toBeijingDayjs().endOf('day'),
  ]);
  const [country, setCountry] = useState<string>('');
  const [groupBy, setGroupBy] = useState<string>('hour');
  const [loading, setLoading] = useState(false);
  const [forceRefreshLoading, setForceRefreshLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const progressStartRef = useRef<number | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const completedCountRef = useRef(0);
  const totalPromisesRef = useRef(0);
  const runningLabelsRef = useRef<string[]>([]);
  const lastCompletedRef = useRef<{ label: string; failed?: boolean } | null>(
    null,
  );
  const taskStartTimesRef = useRef<Record<string, number>>({});
  const taskDurationAvgRef = useRef<Record<string, number>>({});
  const progressProfileRef = useRef<ProgressProfile>({});
  // 三个表格各自的时间槽粒度
  const [allCountriesTimeSlot, setAllCountriesTimeSlot] =
    useState<string>('hour');
  const [regionTimeSlot, setRegionTimeSlot] = useState<string>('hour');
  const [periodTimeSlot, setPeriodTimeSlot] = useState<string>('hour');
  // 三个图表各自的数量/百分比模式
  const [countryBarValueMode, setCountryBarValueMode] = useState<
    'count' | 'percent'
  >('count');
  const [countryPieValueMode, setCountryPieValueMode] = useState<
    'count' | 'percent'
  >('count');
  const [variantGroupValueMode, setVariantGroupValueMode] = useState<
    'count' | 'percent'
  >('count');

  // 统计数据
  const [timeStatistics, setTimeStatistics] = useState<API.TimeStatistics[]>(
    [],
  );
  const [countryStatistics, setCountryStatistics] = useState<
    API.CountryStatistics[]
  >([]);
  const [variantGroupStatistics, setVariantGroupStatistics] = useState<
    API.VariantGroupStatistics[]
  >([]);
  const [overallStatistics, setOverallStatistics] =
    useState<API.MonitorStatistics>({});
  const [peakHoursStatistics, setPeakHoursStatistics] =
    useState<API.PeakHoursStatistics>({});
  // 高峰期区域显示状态（key为区域代码，value为是否显示）
  const [peakAreaVisible, setPeakAreaVisible] = useState<
    Record<string, boolean>
  >({
    US: true,
    UK: true,
    EU_OTHER: true,
  });
  // 汇总表格数据
  const [allCountriesSummary, setAllCountriesSummary] =
    useState<API.AllCountriesSummary | null>(null);
  const [regionSummary, setRegionSummary] = useState<API.RegionSummary[]>([]);
  const [periodSummary, setPeriodSummary] = useState<{
    list: API.PeriodSummary[];
    total: number;
    current: number;
    pageSize: number;
  }>({
    list: [],
    total: 0,
    current: 1,
    pageSize: 10,
  });
  // 周期汇总表格筛选条件
  const [periodFilter, setPeriodFilter] = useState<{
    country?: string;
    site?: string;
    brand?: string;
  }>({});
  const [peakHoursMarkAreas, setPeakHoursMarkAreas] = useState<PeakMarkArea[]>(
    [],
  );

  const loadPeriodSummaryTable = useCallback(
    async (
      current = periodSummary.current,
      pageSize = periodSummary.pageSize,
      filter = periodFilter,
      timeSlotGranularity = periodTimeSlot,
    ) => {
      const startTime = dateRange[0].format('YYYY-MM-DD HH:mm:ss');
      const endTime = dateRange[1].format('YYYY-MM-DD HH:mm:ss');
      const result = await getPeriodSummary({
        startTime,
        endTime,
        ...filter,
        timeSlotGranularity,
        current,
        pageSize,
      });
      setPeriodSummary(
        normalizePeriodSummaryResponse(result, current, pageSize),
      );
    },
    [
      dateRange,
      periodFilter,
      periodSummary.current,
      periodSummary.pageSize,
      periodTimeSlot,
    ],
  );

  // 加载所有统计数据（使用useCallback优化，支持重试）
  const loadStatistics = useCallback(
    async (retryCount = 0) => {
      // 检查日期范围，如果超过30天，提示用户
      const daysDiff = dateRange[1].diff(dateRange[0], 'day');
      if (daysDiff > 30) {
        message.warning(
          '查询时间范围较大，可能影响加载速度，建议选择30天以内的范围',
        );
      }

      setLoading(true);
      setProgress(0);
      setProgressText('');
      progressStartRef.current = Date.now();
      completedCountRef.current = 0;
      totalPromisesRef.current = 0;
      runningLabelsRef.current = [];
      lastCompletedRef.current = null;
      taskStartTimesRef.current = {};
      progressProfileRef.current = readProgressProfile();
      taskDurationAvgRef.current = {};
      if (progressTimerRef.current) {
        window.clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      const maxRetries = 3;

      try {
        const startTime = dateRange[0].format('YYYY-MM-DD HH:mm:ss');
        const endTime = dateRange[1].format('YYYY-MM-DD HH:mm:ss');
        const params: any = {
          startTime,
          endTime,
        };
        if (country) {
          params.country = country;
        }

        const estimateRemainingMs = () => {
          const runningLabels = runningLabelsRef.current;
          if (runningLabels.length === 0) {
            return 0;
          }
          const total = totalPromisesRef.current;
          const completed = completedCountRef.current;
          const avgDurations = taskDurationAvgRef.current;
          const throughputPerTask =
            completed > 0 && progressStartRef.current
              ? (Date.now() - progressStartRef.current) / completed
              : null;
          const completedAverages = Object.values(avgDurations).filter(
            (value) => Number.isFinite(value) && value > 0,
          );
          const globalAvg =
            completedAverages.length > 0
              ? completedAverages.reduce((sum, value) => sum + value, 0) /
                completedAverages.length
              : null;
          const estimateByThroughput =
            completed > 0 && total > completed && throughputPerTask
              ? throughputPerTask * (total - completed)
              : null;
          let maxRemaining = 0;
          for (const label of runningLabels) {
            const startTime = taskStartTimesRef.current[label];
            const elapsedMs = startTime ? Date.now() - startTime : 0;
            const profile = progressProfileRef.current[label];
            const estimateByTotal =
              profile?.avgPerItemMs && profile?.lastTotal
                ? profile.avgPerItemMs * profile.lastTotal
                : null;
            const estimate =
              estimateByTotal ||
              avgDurations[label] ||
              profile?.avgDurationMs ||
              globalAvg ||
              throughputPerTask;
            if (!estimate) {
              return null;
            }
            const minRemaining = Math.min(Math.max(estimate * 0.1, 1000), 5000);
            const remaining = Math.max(estimate - elapsedMs, minRemaining);
            if (remaining > maxRemaining) {
              maxRemaining = remaining;
            }
          }
          if (estimateByThroughput) {
            return Math.round(maxRemaining * 0.6 + estimateByThroughput * 0.4);
          }
          return maxRemaining;
        };

        const getTimeMeta = () => {
          const startTime = progressStartRef.current;
          if (!startTime) {
            return '';
          }
          const elapsedMs = Date.now() - startTime;
          const elapsedText = formatDuration(elapsedMs);
          const remainingMs = estimateRemainingMs();
          const remainingText =
            remainingMs === null ? '--' : formatDuration(remainingMs);
          return `已用时 ${elapsedText} · 预计剩余 ${remainingText}`;
        };

        const getStatusText = () => {
          const completed = completedCountRef.current;
          const total = totalPromisesRef.current;
          const runningLabels = runningLabelsRef.current;
          let statusDetail = '准备开始';
          if (runningLabels.length > 0) {
            const activeLabel = runningLabels[0];
            statusDetail =
              runningLabels.length > 1
                ? `正在处理：${activeLabel} 等${runningLabels.length}项`
                : `正在处理：${activeLabel}`;
          } else if (lastCompletedRef.current?.label) {
            statusDetail = `最近完成：${lastCompletedRef.current.label}${
              lastCompletedRef.current.failed ? '（失败）' : ''
            }`;
          }
          return `加载统计中 · 已完成 ${completed}/${total} · ${statusDetail}`;
        };

        const updateProgressText = () => {
          setProgressText(`${getStatusText()}\n${getTimeMeta()}`);
        };

        // 并行加载所有统计数据
        const tasks: Array<{ label: string; run: () => Promise<any> }> = [
          {
            label: '时间趋势统计',
            run: () => getStatisticsByTime({ ...params, groupBy }),
          },
          {
            label: '国家维度统计',
            run: () =>
              getASINStatisticsByCountry({
                country,
                startTime,
                endTime,
              }),
          },
          {
            label: '变体组Top 10',
            run: () =>
              getASINStatisticsByVariantGroup({
                limit: 10,
                country,
                startTime,
                endTime,
              }),
          },
          {
            label: '总体统计',
            run: () => getMonitorStatistics({ ...params, checkType: 'ASIN' }),
          },
          {
            label: '全国家汇总',
            run: () =>
              getAllCountriesSummary({
                ...params,
                timeSlotGranularity: allCountriesTimeSlot,
              }),
          },
          {
            label: '区域汇总',
            run: () =>
              getRegionSummary({
                ...params,
                timeSlotGranularity: regionTimeSlot,
              }),
          },
          {
            label: '周期汇总',
            run: () =>
              getPeriodSummary({
                ...params,
                ...periodFilter,
                timeSlotGranularity: periodTimeSlot,
                current: periodSummary.current,
                pageSize: periodSummary.pageSize,
              }),
          },
        ];

        // 如果选择了国家，加载高峰期统计
        if (country) {
          tasks.push({
            label: '高峰期统计',
            run: () =>
              getPeakHoursStatistics({
                ...params,
                country,
                checkType: 'ASIN',
              }),
          });
        }

        // 跟踪进度：为每个 promise 添加进度更新
        const totalPromises = tasks.length;
        let completedCount = 0;
        totalPromisesRef.current = totalPromises;
        completedCountRef.current = 0;
        tasks.forEach((task) => {
          const cached = progressProfileRef.current[task.label];
          if (cached?.avgDurationMs) {
            taskDurationAvgRef.current[task.label] = cached.avgDurationMs;
          }
        });
        runningLabelsRef.current = tasks.map((task) => task.label);
        const taskStartTimes: Record<string, number> = {};
        const now = Date.now();
        tasks.forEach((task) => {
          taskStartTimes[task.label] = now;
        });
        taskStartTimesRef.current = taskStartTimes;
        updateProgressText();
        progressTimerRef.current = window.setInterval(() => {
          updateProgressText();
        }, 300);

        const runTaskWithProgress = async (task: {
          label: string;
          run: () => Promise<any>;
        }) => {
          const { label, run } = task;
          taskStartTimesRef.current[label] = Date.now();
          return run()
            .then((result) => {
              completedCount++;
              const newProgress = Math.round(
                (completedCount / totalPromises) * 100,
              );
              setProgress(newProgress);
              completedCountRef.current = completedCount;
              runningLabelsRef.current = runningLabelsRef.current.filter(
                (item) => item !== label,
              );
              lastCompletedRef.current = { label, failed: false };
              const endTime = Date.now();
              const startTime = taskStartTimesRef.current[label];
              if (startTime) {
                const duration = Math.max(0, endTime - startTime);
                const previousAvg = taskDurationAvgRef.current[label];
                taskDurationAvgRef.current[label] = previousAvg
                  ? Math.round(previousAvg * 0.7 + duration * 0.3)
                  : duration;
                const profile = progressProfileRef.current[label] || {};
                profile.avgDurationMs = taskDurationAvgRef.current[label];
                if (label === '周期汇总') {
                  const total = (result as any)?.data?.total;
                  if (Number.isFinite(total) && total > 0) {
                    const perItemMs = duration / total;
                    const prevPerItem = profile.avgPerItemMs;
                    profile.avgPerItemMs = prevPerItem
                      ? prevPerItem * 0.7 + perItemMs * 0.3
                      : perItemMs;
                    profile.lastTotal = total;
                  }
                }
                progressProfileRef.current[label] = profile;
                writeProgressProfile(progressProfileRef.current);
              }
              setProgressText(`${getStatusText()}\n${getTimeMeta()}`);
              return result;
            })
            .catch((error) => {
              completedCount++;
              const newProgress = Math.round(
                (completedCount / totalPromises) * 100,
              );
              setProgress(newProgress);
              completedCountRef.current = completedCount;
              runningLabelsRef.current = runningLabelsRef.current.filter(
                (item) => item !== label,
              );
              lastCompletedRef.current = { label, failed: true };
              const endTime = Date.now();
              const startTime = taskStartTimesRef.current[label];
              if (startTime) {
                const duration = Math.max(0, endTime - startTime);
                const previousAvg = taskDurationAvgRef.current[label];
                taskDurationAvgRef.current[label] = previousAvg
                  ? Math.round(previousAvg * 0.7 + duration * 0.3)
                  : duration;
                const profile = progressProfileRef.current[label] || {};
                profile.avgDurationMs = taskDurationAvgRef.current[label];
                progressProfileRef.current[label] = profile;
                writeProgressProfile(progressProfileRef.current);
              }
              setProgressText(`${getStatusText()}\n${getTimeMeta()}`);
              throw error;
            });
        };

        // 限制并发，避免一次性压垮后端统计查询
        const maxConcurrency = 3;
        const results: PromiseSettledResult<any>[] = new Array(tasks.length);
        let taskCursor = 0;

        const workers = Array.from(
          { length: Math.min(maxConcurrency, tasks.length) },
          async () => {
            while (true) {
              const currentIndex = taskCursor;
              taskCursor += 1;
              if (currentIndex >= tasks.length) {
                return;
              }

              try {
                const value = await runTaskWithProgress(tasks[currentIndex]);
                results[currentIndex] = { status: 'fulfilled', value };
              } catch (reason) {
                results[currentIndex] = { status: 'rejected', reason };
              }
            }
          },
        );

        await Promise.all(workers);

        // 检查是否有失败的请求
        const failedCount = results.filter(
          (r) => r.status === 'rejected',
        ).length;
        if (failedCount > 0) {
          const errorMessages = results
            .filter((r) => r.status === 'rejected')
            .map(
              (r) => (r as PromiseRejectedResult).reason?.message || '未知错误',
            )
            .join('; ');

          // 如果是网络错误或超时，且还有重试次数，则重试
          const hasRetryableError = results.some((r) => {
            if (r.status === 'rejected') {
              const error = (r as PromiseRejectedResult).reason;
              const errorMsg = error?.message || '';
              return (
                errorMsg.includes('timeout') ||
                errorMsg.includes('network') ||
                errorMsg.includes('ECONNRESET') ||
                errorMsg.includes('Connection lost')
              );
            }
            return false;
          });

          if (hasRetryableError && retryCount < maxRetries) {
            const delay = (retryCount + 1) * 2000; // 2秒、4秒、6秒
            message.warning(
              `数据加载部分失败，${delay / 1000}秒后自动重试 (${
                retryCount + 1
              }/${maxRetries})...`,
            );
            setTimeout(() => {
              loadStatistics(retryCount + 1);
            }, delay);
            return;
          } else if (failedCount === results.length) {
            // 所有请求都失败
            throw new Error(`所有数据加载失败: ${errorMessages}`);
          } else {
            // 部分失败，但继续处理成功的数据
            message.warning(
              `部分数据加载失败 (${failedCount}/${results.length})，将显示可用数据`,
            );
          }
        }

        // 提取结果，处理 rejected 的情况
        // 注意：promises数组长度可能为7或8（取决于是否选择了国家）
        const timeDataResult = results[0];
        const countryDataResult = results[1];
        const variantGroupDataResult = results[2];
        const overallDataResult = results[3];
        const allCountriesDataResult = results[4];
        const regionDataResult = results[5];
        const periodDataResult = results[6];
        const peakDataResult = results[7]; // 可能为undefined（当未选择国家时）

        const timeData =
          timeDataResult?.status === 'fulfilled' ? timeDataResult.value : null;
        const countryData =
          countryDataResult?.status === 'fulfilled'
            ? countryDataResult.value
            : null;
        const variantGroupData =
          variantGroupDataResult?.status === 'fulfilled'
            ? variantGroupDataResult.value
            : null;
        const overallData =
          overallDataResult?.status === 'fulfilled'
            ? overallDataResult.value
            : null;
        const peakData =
          peakDataResult?.status === 'fulfilled' ? peakDataResult.value : null;

        const { data: timeStats } = unwrapAnalyticsResponse<
          API.TimeStatistics[]
        >(timeData, []);
        const { data: countryStats } = unwrapAnalyticsResponse<
          API.CountryStatistics[]
        >(countryData, []);
        const { data: variantGroupStats } = unwrapAnalyticsResponse<
          API.VariantGroupStatistics[]
        >(variantGroupData, []);
        const overallStats =
          overallData &&
          typeof overallData === 'object' &&
          !('success' in overallData)
            ? overallData
            : (overallData as any)?.data || {};

        setTimeStatistics(timeStats as API.TimeStatistics[]);
        setCountryStatistics(countryStats as API.CountryStatistics[]);
        setVariantGroupStatistics(
          variantGroupStats as API.VariantGroupStatistics[],
        );
        setOverallStatistics(overallStats);

        // 处理高峰期统计数据
        if (country && peakData) {
          const peakStats =
            peakData && typeof peakData === 'object' && !('success' in peakData)
              ? peakData
              : (peakData as any)?.data || {};
          setPeakHoursStatistics(peakStats);
        } else {
          setPeakHoursStatistics({});
        }

        // 处理汇总表格数据
        // 确保正确处理返回数据，包括 success 包装的情况
        let allCountriesStats = null;
        if (allCountriesDataResult?.status === 'fulfilled') {
          const payload =
            unwrapAnalyticsResponse<API.AllCountriesSummary | null>(
              allCountriesDataResult.value,
              null,
            );
          allCountriesStats = payload.data;
        }
        setAllCountriesSummary(allCountriesStats);

        let regionStats: API.RegionSummary[] = [];
        if (regionDataResult?.status === 'fulfilled') {
          const payload = unwrapAnalyticsResponse<API.RegionSummary[]>(
            regionDataResult.value,
            [],
          );
          regionStats = Array.isArray(payload.data) ? payload.data : [];
        }
        setRegionSummary(regionStats);

        let periodStats: {
          list: API.PeriodSummary[];
          total: number;
          current: number;
          pageSize: number;
        } = {
          list: [],
          total: 0,
          current: periodSummary.current,
          pageSize: periodSummary.pageSize,
        };
        if (periodDataResult?.status === 'fulfilled') {
          const payload = unwrapAnalyticsResponse<{
            list?: API.PeriodSummary[];
            total?: number;
            current?: number;
            pageSize?: number;
          }>(periodDataResult.value, periodStats);
          const normalizedData = payload.data || {};
          periodStats = {
            list: normalizedData.list || [],
            total: normalizedData.total || 0,
            current: normalizedData.current || periodSummary.current,
            pageSize: normalizedData.pageSize || periodSummary.pageSize,
          };
        }
        setPeriodSummary(periodStats);
      } catch (error: any) {
        console.error('加载统计数据失败:', error);

        // 如果是网络错误或超时，且还有重试次数，则重试
        const errorMessage = error?.message || '';
        const isRetryableError =
          errorMessage.includes('timeout') ||
          errorMessage.includes('network') ||
          errorMessage.includes('ECONNRESET') ||
          errorMessage.includes('Connection lost');

        if (isRetryableError && retryCount < maxRetries) {
          const delay = (retryCount + 1) * 2000; // 2秒、4秒、6秒
          message.warning(
            `数据加载失败，${delay / 1000}秒后自动重试 (${
              retryCount + 1
            }/${maxRetries})...`,
          );
          setTimeout(() => {
            loadStatistics(retryCount + 1);
          }, delay);
          return;
        }

        message.error(
          `加载统计数据失败${retryCount > 0 ? '（已重试）' : ''}，请稍后重试`,
        );
      } finally {
        setLoading(false);
        setProgress(0);
        setProgressText('');
        progressStartRef.current = null;
        if (progressTimerRef.current) {
          window.clearInterval(progressTimerRef.current);
          progressTimerRef.current = null;
        }
      }
    },
    [
      dateRange,
      country,
      groupBy,
      periodFilter,
      periodSummary.current,
      periodSummary.pageSize,
      allCountriesTimeSlot,
      regionTimeSlot,
      periodTimeSlot,
      message,
    ],
  );

  // 只在组件首次加载时执行一次查询
  useEffect(() => {
    loadStatistics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (progressTimerRef.current) {
        window.clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
    };
  }, []);

  // 时间趋势图表数据
  // 注意：确保数据顺序与颜色数组顺序一致（按字母顺序：异常、正常、总计）
  const normalizedOverall = useMemo(() => {
    return {
      totalDurationHours: toNumber(
        (overallStatistics as any).totalDurationHours || 0,
      ),
      abnormalDurationHours: toNumber(
        (overallStatistics as any).abnormalDurationHours || 0,
      ),
      normalDurationHours: toNumber(
        (overallStatistics as any).normalDurationHours || 0,
      ),
      ratioAllTime: toNumber((overallStatistics as any).ratioAllTime || 0),
    };
  }, [overallStatistics]);

  const timeChartData = useMemo(() => {
    return timeStatistics.flatMap((item) => {
      const timeLabel = item.time_period || (item as any).timePeriod || '';
      const parsedTime = parseTimeLabel(timeLabel);
      if (!parsedTime) {
        return [];
      }
      const ratioAllTime = toNumber(
        (item as any).ratioAllTime ?? item.ratio_all_time ?? 0,
      );
      const totalDurationHours = toNumber(
        (item as any).totalDurationHours || 0,
      );
      const abnormalDurationHours = toNumber(
        (item as any).abnormalDurationHours || 0,
      );

      if (!Number.isFinite(ratioAllTime)) {
        return [];
      }

      return [
        {
          time: parsedTime,
          type: '所有ASIN异常时长占比',
          value: ratioAllTime,
          rawValue: ratioAllTime,
          totalDurationHours,
          abnormalDurationHours,
          labelValue: `${ratioAllTime.toFixed(
            2,
          )}% (${abnormalDurationHours.toFixed(2)}/${totalDurationHours.toFixed(
            2,
          )} 小时)`,
        },
      ];
    });
  }, [timeStatistics]);

  const lineTypes = ['所有ASIN异常时长占比'];
  const lineColorMap: Record<string, string> = {
    所有ASIN异常时长占比: '#1890ff',
  };

  // 国家颜色映射（用于饼图和柱状图）
  const countryColorPalette: Record<
    string,
    { normal: string; broken: string }
  > = {
    美国: { normal: '#52c41a', broken: '#ff4d4f' },
    欧洲汇总: { normal: '#73d13d', broken: '#ff7875' },
    英国: { normal: '#95de64', broken: '#ffa39e' },
    德国: { normal: '#b7eb8f', broken: '#ffccc7' },
    法国: { normal: '#d9f7be', broken: '#ffe7e6' },
    意大利: { normal: '#f6ffed', broken: '#fff1f0' },
    西班牙: { normal: '#e6f7ff', broken: '#ffadd2' },
  };

  // 饼图颜色数组（为每个国家分配不同颜色）
  const pieColorArray = [
    '#1890ff', // 蓝色
    '#52c41a', // 绿色
    '#faad14', // 橙色
    '#f5222d', // 红色
    '#722ed1', // 紫色
    '#13c2c2', // 青色
    '#eb2f96', // 粉红色
    '#fa8c16', // 橙红色
    '#2f54eb', // 深蓝色
    '#a0d911', // 黄绿色
  ];

  // 高峰期背景区域（仅在按小时分组时显示）
  useEffect(() => {
    let cancelled = false;

    if (groupBy !== 'hour' || timeChartData.length === 0) {
      setPeakHoursMarkAreas([]);
      return () => {
        cancelled = true;
      };
    }

    const firstTime = timeChartData[0]?.time;
    const lastTime = timeChartData[timeChartData.length - 1]?.time;
    if (!firstTime || !lastTime) {
      setPeakHoursMarkAreas([]);
      return () => {
        cancelled = true;
      };
    }

    void getAnalyticsPeakMarkAreas({
      groupBy,
      country,
      startTime: toBeijingDayjs(firstTime)
        .startOf('day')
        .format('YYYY-MM-DD HH:mm:ss'),
      endTime: toBeijingDayjs(lastTime)
        .endOf('day')
        .format('YYYY-MM-DD HH:mm:ss'),
    })
      .then((areas) => {
        if (cancelled) {
          return;
        }
        const responseData =
          areas && typeof areas === 'object' && !('success' in areas)
            ? areas
            : (areas as any)?.data || [];
        setPeakHoursMarkAreas(Array.isArray(responseData) ? responseData : []);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setPeakHoursMarkAreas([]);
      });

    return () => {
      cancelled = true;
    };
  }, [country, groupBy, timeChartData]);

  const lineChartOptions = useMemo(() => {
    const series: any[] = lineTypes.map((type, index) => {
      const data = timeChartData
        .filter((item) => item.type === type)
        .map((item) => [
          formatBeijing(item.time, 'YYYY-MM-DD HH:mm'),
          Number(item.value),
          Number(item.rawValue),
          item.labelValue,
        ]);

      // 只在第一个系列添加高峰期背景
      let markAreaConfig = undefined;
      if (index === 0 && peakHoursMarkAreas.length > 0) {
        // 合并所有区域的高峰期数据，每个区域使用自己的颜色
        // 根据peakAreaVisible状态过滤显示的区域
        const allAreas: any[] = [];
        peakHoursMarkAreas.forEach((region) => {
          // 只添加可见的区域
          if (peakAreaVisible[region.name] !== false) {
            region.areas.forEach((area) => {
              allAreas.push([
                {
                  ...area[0],
                  itemStyle: {
                    color: region.color,
                  },
                },
                {
                  ...area[1],
                  itemStyle: {
                    color: region.color,
                  },
                },
              ]);
            });
          }
        });

        if (allAreas.length > 0) {
          markAreaConfig = {
            label: {
              show: false,
            },
            data: allAreas,
          };
        }
      }

      return {
        name: type,
        type: 'line',
        smooth: true,
        showSymbol: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: {
          width: 3,
          color: lineColorMap[type],
        },
        itemStyle: {
          color: lineColorMap[type],
        },
        emphasis: {
          focus: 'series',
        },
        connectNulls: true,
        data,
        yAxisIndex: 0, // 都使用左侧Y轴
        markArea: markAreaConfig,
      };
    });

    // 为高峰期区域创建虚拟series用于图例显示（仅在按小时分组时）
    if (groupBy === 'hour' && peakHoursMarkAreas.length > 0) {
      peakHoursMarkAreas.forEach((region) => {
        const areaName = peakAreaNameMap[region.name] || region.name;
        // 创建一个隐藏的series，只用于图例显示和交互
        // 使用areaStyle来显示颜色块，但不显示线条
        series.push({
          name: areaName,
          type: 'line',
          data: [], // 空数据，不显示线条
          lineStyle: {
            width: 0,
            color: 'transparent',
          },
          itemStyle: {
            color: region.color.replace('0.15', '0.8'), // 使用不透明的颜色用于图例
          },
          areaStyle: {
            color: region.color.replace('0.15', '0.3'), // 图例显示用的颜色
          },
          showSymbol: false,
          silent: true, // 不响应鼠标事件
          legendHoverLink: false,
          // 不在这里添加markArea，因为markArea已经在第一个series上了
        });
      });
    }
    return {
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const points = Array.isArray(params) ? params : [params];
          const content = points
            .map((param: any) => {
              const labelValue = param.value?.[3] || '';
              return `
                <div style="display:flex;justify-content:space-between">
                  <span>${param.seriesName}</span>
                  <span>${labelValue}</span>
                </div>`;
            })
            .join('');
          const axisVal = points[0]?.axisValue ?? '';
          return `<div style="margin-bottom:4px;font-weight:600;">${axisVal}</div>${content}`;
        },
      },
      legend: {
        data: [
          ...lineTypes,
          // 添加高峰期区域图例（仅在按小时分组时显示）
          ...(groupBy === 'hour' && peakHoursMarkAreas.length > 0
            ? peakHoursMarkAreas.map(
                (region) => peakAreaNameMap[region.name] || region.name,
              )
            : []),
        ],
        top: 8,
        selected: {
          // 设置高峰期区域的初始选中状态
          ...(groupBy === 'hour' && peakHoursMarkAreas.length > 0
            ? peakHoursMarkAreas.reduce((acc, region) => {
                const name = peakAreaNameMap[region.name] || region.name;
                acc[name] = peakAreaVisible[region.name] !== false;
                return acc;
              }, {} as Record<string, boolean>)
            : {}),
        },
      },
      grid: {
        left: '3%',
        right: '3%',
        bottom: '10%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
      },
      yAxis: [
        {
          type: 'value',
          name: '异常占比 (%)',
          position: 'left',
          min: 0,
          max: 100,
          axisLabel: {
            formatter: '{value}%',
          },
        },
      ],
      dataZoom: [
        {
          type: 'slider',
          show: true,
          xAxisIndex: [0],
          start: 0,
          end: 100,
          height: 30,
          bottom: 10,
          handleIcon:
            'path://M30.9,53.2C16.8,53.2,5.3,41.7,5.3,27.6S16.8,2,30.9,2C45,2,56.4,13.5,56.4,27.6S45,53.2,30.9,53.2z M30.9,3.5C17.6,3.5,6.8,14.4,6.8,27.6c0,13.3,10.8,24.1,24.1,24.1C44.2,51.7,55,40.9,55,27.6C54.9,14.4,44.1,3.5,30.9,3.5z M36.9,35.8c0,0.6-0.4,1-1,1H26.8c-0.6,0-1-0.4-1-1V19.5c0-0.6,0.4-1,1-1h9.2c0.6,0,1,0.4,1,1V35.8z',
          handleSize: '80%',
          handleStyle: {
            color: '#fff',
            shadowBlur: 3,
            shadowColor: 'rgba(0, 0, 0, 0.6)',
            shadowOffsetX: 2,
            shadowOffsetY: 2,
          },
        },
        {
          type: 'inside',
          xAxisIndex: [0],
          start: 0,
          end: 100,
        },
      ],
      series,
    };
  }, [timeChartData, peakHoursMarkAreas, peakAreaVisible, groupBy]);

  // 处理图例点击事件
  const handleLegendSelectChanged = useCallback((params: any) => {
    // 检查是否是高峰期区域的图例被点击
    const peakAreaNames = Object.values(peakAreaNameMap);
    if (peakAreaNames.includes(params.name)) {
      // 找到对应的区域代码
      const regionCode = Object.keys(peakAreaNameMap).find(
        (key) => peakAreaNameMap[key] === params.name,
      );
      if (regionCode) {
        setPeakAreaVisible((prev) => ({
          ...prev,
          [regionCode]: params.selected[params.name] !== false,
        }));
      }
    }
  }, []);

  // 国家统计柱状图数据（基于查询时间范围内的时长统计）
  // 注意：确保数据顺序与颜色数组顺序一致
  const countryColumnData = useMemo(() => {
    const data = countryStatistics.flatMap((item) => {
      const countryLabel = countryMap[item.country || ''] || item.country;
      const abnormalDurationHours = toNumber(
        (item as any).abnormalDurationHours || 0,
      );
      const normalDurationHours = toNumber(
        (item as any).normalDurationHours || 0,
      );
      return [
        attachLabelValue(
          {
            country: countryLabel,
            type: '异常',
            value: abnormalDurationHours,
            rawValue: abnormalDurationHours,
          },
          countryBarValueMode,
        ),
        attachLabelValue(
          {
            country: countryLabel,
            type: '正常',
            value: normalDurationHours,
            rawValue: normalDurationHours,
          },
          countryBarValueMode,
        ),
      ];
    });
    return filterValidValuesByKey(data, 'value');
  }, [countryStatistics, countryBarValueMode]);

  const countryColumnDisplayData = useMemo(() => {
    if (countryBarValueMode === 'count') {
      return countryColumnData;
    }
    const totalsByCountry = countryColumnData.reduce((acc, item) => {
      acc[item.country] = (acc[item.country] || 0) + toNumber(item.rawValue);
      return acc;
    }, {} as Record<string, number>);
    const percentData = countryColumnData.map((item) => {
      const total = totalsByCountry[item.country] || 0;
      return attachLabelValue(
        {
          ...item,
          value: total ? (toNumber(item.rawValue) / total) * 100 : 0,
        },
        countryBarValueMode,
      );
    });
    return filterValidValuesByKey(percentData, 'value');
  }, [countryColumnData, countryBarValueMode]);

  // 国家统计饼图数据（按异常时长分布）
  const countryPieData = useMemo(() => {
    const data = countryStatistics.map((item) => {
      const abnormalDurationHours = toNumber(
        (item as any).abnormalDurationHours || 0,
      );
      return attachLabelValue(
        {
          type: countryMap[item.country || ''] || item.country,
          value: abnormalDurationHours,
          rawValue: abnormalDurationHours,
        },
        countryPieValueMode,
      );
    });
    if (countryPieValueMode === 'count') {
      return filterValidValuesByKey(data, 'value');
    }
    const total = data.reduce((sum, item) => sum + item.value, 0);
    const percentData = data.map((item) =>
      attachLabelValue(
        {
          ...item,
          value: total ? (item.value / total) * 100 : 0,
        },
        countryPieValueMode,
      ),
    );
    return filterValidValuesByKey(percentData, 'value');
  }, [countryStatistics, countryPieValueMode]);

  // 变体组统计柱状图数据（按异常时长）
  const variantGroupColumnData = useMemo(() => {
    const data = variantGroupStatistics.map((item) => {
      const abnormalDurationHours = toNumber(
        (item as any).abnormalDurationHours || 0,
      );
      const abnormalDurationRate = toNumber((item as any).ratioAllTime || 0);
      const countryName = item.country
        ? countryMap[item.country] || item.country
        : '';
      const displayName = countryName
        ? `${item.variant_group_name || '未知'} (${countryName})`
        : item.variant_group_name || '未知';
      return attachLabelValue(
        {
          name: displayName,
          originalName: item.variant_group_name || '未知',
          country: item.country || '',
          countryName: countryName,
          variantGroupId: item.variant_group_id || '',
          value: abnormalDurationHours,
          rawValue: abnormalDurationHours,
          abnormalDurationRate,
        },
        variantGroupValueMode,
      );
    });
    return filterValidValuesByKey(data, 'value');
  }, [variantGroupStatistics, variantGroupValueMode]);

  const variantGroupDisplayData = useMemo(() => {
    if (variantGroupValueMode === 'count') {
      return variantGroupColumnData;
    }
    const percentData = variantGroupColumnData.map((item) =>
      attachLabelValue(
        {
          ...item,
          value: toNumber((item as any).abnormalDurationRate || 0),
          rawValue: toNumber(item.rawValue),
        },
        variantGroupValueMode,
      ),
    );
    return filterValidValuesByKey(percentData, 'value');
  }, [variantGroupColumnData, variantGroupValueMode]);

  const countryTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    countryColumnDisplayData.forEach((item) => {
      const raw = Number(item.rawValue ?? item.value);
      if (!Number.isFinite(raw)) {
        return;
      }
      totals[item.country] = (totals[item.country] || 0) + raw;
    });
    return totals;
  }, [countryColumnDisplayData]);

  const countryBarOptions = useMemo(() => {
    if (!countryColumnDisplayData.length) {
      return {};
    }
    const categories = Array.from(
      new Set(countryColumnDisplayData.map((item) => item.country)),
    );
    // 按类型分组，但为每个国家使用不同颜色
    const series = ['异常', '正常'].map((type) => ({
      name: type,
      type: 'bar',
      stack: 'total',
      emphasis: {
        focus: 'series',
      },
      // 为每个国家分配不同颜色
      itemStyle: {
        color: (params: any) => {
          const countryName = categories[params.dataIndex];
          const colorConfig = countryColorPalette[countryName] || {
            normal: '#52c41a',
            broken: '#ff4d4f',
          };
          return type === '异常' ? colorConfig.broken : colorConfig.normal;
        },
      },
      data: categories.map((country) => {
        const cell = countryColumnDisplayData.find(
          (item) => item.country === country && item.type === type,
        );
        return {
          value: cell ? Number(cell.value) : 0,
          rawValue: cell?.rawValue ?? (cell ? Number(cell.value) : 0),
          labelValue: cell?.labelValue,
        };
      }),
    }));
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'shadow',
        },
        formatter: (params: any) => {
          const points = Array.isArray(params) ? params : [params];
          const content = points
            .map((param: any) => {
              const rawValue =
                Number(param?.data?.rawValue ?? param?.value) || 0;
              const value = Number(param?.data?.value ?? param?.value) || 0;
              const formatted = formatTooltipValue(
                countryBarValueMode,
                value,
                rawValue,
              );
              return `
                <div style="display:flex;justify-content:space-between">
                  <span>${param.seriesName}</span>
                  <span>${formatted}</span>
                </div>`;
            })
            .join('');
          const axisVal = points[0]?.axisValue ?? '';
          const totalRaw = countryTotals[axisVal] ?? 0;
          const totalFormatted = formatTooltipValue(
            'count',
            totalRaw,
            totalRaw,
          );
          return `<div style="margin-bottom:4px;font-weight:600;">${axisVal}（总计：${totalFormatted}）</div>${content}`;
        },
      },
      legend: {
        data: ['异常', '正常'],
        top: 8,
      },
      grid: {
        left: '3%',
        right: '3%',
        bottom: '8%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: categories,
      },
      yAxis: {
        type: 'value',
      },
      series,
    };
  }, [countryColumnDisplayData, countryBarValueMode, countryTotals]);

  const countryPieOptions = useMemo(() => {
    if (!countryPieData.length) {
      return {};
    }
    const data = countryPieData.map((item) => ({
      name: item.type,
      value: Number(item.value),
      rawValue: Number(item.rawValue ?? item.value),
      labelValue: item.labelValue,
    }));
    return {
      tooltip: {
        trigger: 'item',
        formatter: (param: any) => {
          const value = Number(param.value) || 0;
          const rawValue = Number(param.data?.rawValue) || value;
          const formatted = formatTooltipValue(
            countryPieValueMode,
            value,
            rawValue,
          );
          return `${param.name}<br/>${formatted}`;
        },
      },
      legend: {
        orient: 'vertical',
        left: 'right',
        top: 0,
        itemHeight: 8,
      },
      series: [
        {
          name: '国家分布',
          type: 'pie',
          radius: ['45%', '70%'],
          avoidLabelOverlap: false,
          labelLine: {
            length: 12,
            length2: 6,
          },
          data,
          // 为每个国家分配不同颜色
          itemStyle: {
            color: (params: any) => {
              const countryName = params.name;
              const index = data.findIndex((d: any) => d.name === countryName);
              return pieColorArray[index % pieColorArray.length];
            },
          },
        },
      ],
    };
  }, [countryPieData, countryPieValueMode]);

  const variantGroupOptions = useMemo(() => {
    if (!variantGroupDisplayData.length) {
      return {};
    }
    const categories = variantGroupDisplayData.map((item) => item.name);
    const data = variantGroupDisplayData.map((item) => ({
      value: Number(item.value),
      rawValue: item.rawValue ?? Number(item.value),
      labelValue: item.labelValue,
      variantGroupId: (item as any).variantGroupId || '',
      originalName: (item as any).originalName || item.name,
      country: (item as any).country || '',
      countryName: (item as any).countryName || '',
    }));
    return {
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const point = Array.isArray(params) ? params[0] : params;
          const rawValue = Number(point?.data?.rawValue ?? point?.value) || 0;
          const value = Number(point?.data?.value ?? point?.value) || 0;
          const formatted = formatTooltipValue(
            variantGroupValueMode,
            value,
            rawValue,
          );
          const countryName = point?.data?.countryName || '';
          const countryInfo = countryName
            ? `<div>国家: ${countryName}</div>`
            : '';
          return `
            <div>${point?.seriesName}</div>
            <div>${formatted}</div>
            ${countryInfo}`;
        },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        containLabel: true,
      },
      xAxis: {
        type: 'value',
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: categories,
      },
      series: [
        {
          name:
            variantGroupValueMode === 'percent' ? '异常时长占比' : '异常时长',
          type: 'bar',
          data: data.map((item) => ({
            value: item.value,
            rawValue: item.rawValue,
            labelValue: item.labelValue,
            variantGroupId: item.variantGroupId,
            originalName: item.originalName,
            country: item.country,
            countryName: item.countryName,
          })),
          itemStyle: {
            color: '#ff4d4f',
          },
        },
      ],
    };
  }, [variantGroupDisplayData, variantGroupValueMode]);

  const {
    totalDurationHours,
    abnormalDurationHours,
    normalDurationHours,
    ratioAllTime,
  } = normalizedOverall;
  const handleRefreshAll = useCallback(() => {
    void loadStatistics();
  }, [loadStatistics]);

  const handleForceRefreshAnalytics = useCallback(async () => {
    const startTime = dateRange[0].format('YYYY-MM-DD HH:mm:ss');
    const endTime = dateRange[1].format('YYYY-MM-DD HH:mm:ss');

    setForceRefreshLoading(true);
    try {
      await clearAnalyticsCache();
      await refreshAnalyticsAgg({
        startTime,
        endTime,
      });
      message.success('分析缓存与聚合数据已刷新');
      await loadStatistics();
    } catch (error) {
      message.error('强制刷新分析数据失败，请稍后重试');
    } finally {
      setForceRefreshLoading(false);
    }
  }, [dateRange, loadStatistics, message]);

  // 导出数据
  const handleExport = async (format: 'excel' | 'csv' = 'excel') => {
    try {
      const startTime = dateRange[0].format('YYYY-MM-DD 00:00:00');
      const endTime = dateRange[1].format('YYYY-MM-DD 23:59:59');

      // 构建查询参数对象
      const queryParams: Record<string, any> = {
        startTime,
        endTime,
      };
      if (country) {
        queryParams.country = country;
      }

      // 注意：后端目前只支持 Excel 格式
      await exportToExcel(
        '/v1/export/monitor-history',
        queryParams,
        `监控历史_${dateRange[0].format('YYYY-MM-DD')}_${dateRange[1].format(
          'YYYY-MM-DD',
        )}_${format.toUpperCase()}`,
      );
    } catch (error) {
      console.error('导出失败:', error);
      message.error('导出失败，请重试');
    }
  };

  const periodTimeSlotColumns = [
    {
      title: '时间槽',
      dataIndex: 'timeSlot',
      key: 'timeSlot',
    },
    {
      title: '总监控时长',
      dataIndex: 'totalDurationHours',
      key: 'totalDurationHours',
      align: 'right' as const,
      render: (value: number) => formatHours(value),
    },
    {
      title: '所有ASIN异常时长占比 (ratio_all_time)',
      dataIndex: 'ratioAllTime',
      key: 'ratioAllTime',
      align: 'right' as const,
      render: (value: number) => formatPercent(value),
    },
    {
      title: '全局高峰异常时长占比 (global_peak_rate)',
      dataIndex: 'globalPeakRate',
      key: 'globalPeakRate',
      align: 'right' as const,
      render: (value: number) => formatPercent(value),
    },
    {
      title: '全局低峰异常时长占比 (global_low_rate)',
      dataIndex: 'globalLowRate',
      key: 'globalLowRate',
      align: 'right' as const,
      render: (value: number) => formatPercent(value),
    },
    {
      title: '局部高峰异常时长占比 (ratio_high)',
      dataIndex: 'ratioHigh',
      key: 'ratioHigh',
      align: 'right' as const,
      render: (value: number) => formatPercent(value),
    },
    {
      title: '局部低峰异常时长占比 (ratio_low)',
      dataIndex: 'ratioLow',
      key: 'ratioLow',
      align: 'right' as const,
      render: (value: number) => formatPercent(value),
    },
  ];

  const renderPeriodTimeSlotDetails = (record: API.PeriodSummary) => (
    <Table
      size="small"
      pagination={false}
      dataSource={record.timeSlotDetails || []}
      rowKey={(detail, index) =>
        `${record.country || ''}_${record.site || ''}_${record.brand || ''}_${
          detail.timeSlot || index
        }`
      }
      columns={periodTimeSlotColumns}
      scroll={{ x: 1100 }}
    />
  );

  return (
    <PageContainer
      header={{
        title: '数据分析',
        breadcrumb: {},
      }}
      extra={[
        <Button key="export-excel" onClick={() => handleExport('excel')}>
          导出Excel
        </Button>,
        <Button key="export-csv" onClick={() => handleExport('csv')}>
          导出CSV
        </Button>,
        access.canReadSettings ? (
          <Button key="ops" onClick={() => history.push('/ops')}>
            运维页
          </Button>
        ) : null,
        access.canWriteSettings ? (
          <Button
            key="force-refresh"
            onClick={() => void handleForceRefreshAnalytics()}
            loading={forceRefreshLoading}
          >
            强制刷新分析数据
          </Button>
        ) : null,
        <Button
          key="refresh"
          type="primary"
          onClick={handleRefreshAll}
          loading={loading}
        >
          刷新
        </Button>,
      ]}
    >
      {/* 筛选条件 */}
      <Card style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <Space wrap>
            <span>时间范围：</span>
            <RangePicker
              value={dateRange}
              onChange={(dates) => {
                if (dates) {
                  setDateRange([dates[0]!, dates[1]!]);
                }
              }}
              format="YYYY-MM-DD HH:mm"
              showTime={{ format: 'HH:mm' }}
              placeholder={['开始时间', '结束时间']}
              style={{ width: 380 }}
            />
            <span>国家：</span>
            <Select
              style={{ width: 150 }}
              value={country}
              onChange={setCountry}
              allowClear
              placeholder="全部国家"
            >
              {Object.entries(countryMap).map(([key, value]) => (
                <Select.Option key={key} value={key}>
                  {value}
                </Select.Option>
              ))}
            </Select>
            <span>时间分组：</span>
            <Select
              style={{ width: 120 }}
              value={groupBy}
              onChange={setGroupBy}
            >
              <Select.Option value="hour">按小时</Select.Option>
              <Select.Option value="day">按天</Select.Option>
              <Select.Option value="week">按周</Select.Option>
              <Select.Option value="month">按月</Select.Option>
            </Select>
            <Button type="primary" onClick={handleRefreshAll} loading={loading}>
              查询
            </Button>
          </Space>
          {loading && (progress > 0 || progressText) && (
            <div style={{ marginTop: 8 }}>
              <Progress
                percent={progress}
                status="active"
                strokeColor={{
                  '0%': '#108ee9',
                  '100%': '#87d068',
                }}
              />
              {progressText && (
                <div
                  style={{
                    marginTop: 4,
                    color: '#666',
                    fontSize: 12,
                    whiteSpace: 'pre-line',
                  }}
                >
                  {progressText}
                </div>
              )}
            </div>
          )}
        </Space>
      </Card>

      {/* 总体统计 */}
      <StatisticCard.Group>
        <StatisticCard
          statistic={{
            title: '总监控时长',
            value: formatHours(totalDurationHours),
          }}
        />
        <StatisticCard
          statistic={{
            title: '正常时长',
            value: formatHours(normalDurationHours),
            status: 'success',
          }}
        />
        <StatisticCard
          statistic={{
            title: '异常时长',
            value: formatHours(abnormalDurationHours),
            status: 'error',
          }}
        />
        <StatisticCard
          statistic={{
            title: '异常时长占比',
            value: `${ratioAllTime.toFixed(2)}%`,
          }}
        />
        {country && peakHoursStatistics.peakDurationHours !== undefined && (
          <>
            <StatisticCard
              statistic={{
                title: '高峰期异常时长占比',
                value: peakHoursStatistics.peakDurationHours
                  ? `${(peakHoursStatistics.peakDurationRate || 0).toFixed(2)}%`
                  : '0%',
                description: `高峰期: ${formatHours(
                  peakHoursStatistics.peakAbnormalDurationHours || 0,
                )}/${formatHours(peakHoursStatistics.peakDurationHours || 0)}`,
              }}
            />
            <StatisticCard
              statistic={{
                title: '低峰期异常时长占比',
                value: peakHoursStatistics.offPeakDurationHours
                  ? `${(peakHoursStatistics.offPeakDurationRate || 0).toFixed(
                      2,
                    )}%`
                  : '0%',
                description: `低峰期: ${formatHours(
                  peakHoursStatistics.offPeakAbnormalDurationHours || 0,
                )}/${formatHours(
                  peakHoursStatistics.offPeakDurationHours || 0,
                )}`,
              }}
            />
          </>
        )}
      </StatisticCard.Group>

      {/* 图表区域 */}
      <Row gutter={16} style={{ marginTop: 16 }}>
        {/* 时间趋势图 */}
        <Col span={24}>
          <Card title="监控趋势分析" loading={loading}>
            {timeChartData.length > 0 ? (
              <LazyECharts
                option={lineChartOptions}
                style={{ width: '100%', height: 420 }}
                onEvents={{
                  legendselectchanged: handleLegendSelectChanged,
                }}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 40 }}>暂无数据</div>
            )}
          </Card>
        </Col>

        {/* 国家统计 */}
        <Col span={12} style={{ marginTop: 16 }}>
          <Card
            title="国家维度时长统计（柱状图）"
            loading={loading}
            extra={
              <Radio.Group
                value={countryBarValueMode}
                onChange={(e) => setCountryBarValueMode(e.target.value)}
                optionType="button"
                buttonStyle="solid"
                size="small"
              >
                <Radio.Button value="count">时长</Radio.Button>
                <Radio.Button value="percent">百分比</Radio.Button>
              </Radio.Group>
            }
          >
            {countryColumnDisplayData.length > 0 ? (
              <LazyECharts
                option={countryBarOptions}
                style={{ width: '100%', height: 320 }}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 40 }}>暂无数据</div>
            )}
          </Card>
        </Col>

        <Col span={12} style={{ marginTop: 16 }}>
          <Card
            title="国家异常时长分布（饼图）"
            loading={loading}
            extra={
              <Radio.Group
                value={countryPieValueMode}
                onChange={(e) => setCountryPieValueMode(e.target.value)}
                optionType="button"
                buttonStyle="solid"
                size="small"
              >
                <Radio.Button value="count">时长</Radio.Button>
                <Radio.Button value="percent">百分比</Radio.Button>
              </Radio.Group>
            }
          >
            {countryPieData.length > 0 ? (
              <LazyECharts
                option={countryPieOptions}
                style={{ width: '100%', height: 320 }}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 40 }}>暂无数据</div>
            )}
          </Card>
        </Col>

        {/* 变体组统计 */}
        <Col span={24} style={{ marginTop: 16 }}>
          <Card
            title="变体组异常时长统计（Top 10）"
            loading={loading}
            extra={
              <Radio.Group
                value={variantGroupValueMode}
                onChange={(e) => setVariantGroupValueMode(e.target.value)}
                optionType="button"
                buttonStyle="solid"
                size="small"
              >
                <Radio.Button value="count">时长</Radio.Button>
                <Radio.Button value="percent">百分比</Radio.Button>
              </Radio.Group>
            }
          >
            {variantGroupDisplayData.length > 0 ? (
              <LazyECharts
                option={variantGroupOptions}
                style={{ width: '100%', height: 360 }}
                onEvents={{
                  click: (params: any) => {
                    const variantGroupId = params.data?.variantGroupId;
                    if (variantGroupId) {
                      history.push(
                        `/monitor-history?type=group&id=${variantGroupId}`,
                      );
                    }
                  },
                }}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 40 }}>暂无数据</div>
            )}
          </Card>
        </Col>
      </Row>

      {/* 汇总表格区域 */}
      <Row gutter={16} style={{ marginTop: 16 }}>
        {/* 全部国家汇总表格 */}
        <Col span={24}>
          <Card
            title="全部国家时长汇总表"
            loading={loading}
            extra={
              <Space>
                <span>时间槽粒度：</span>
                <Select
                  style={{ width: 120 }}
                  value={allCountriesTimeSlot}
                  onChange={(value) => {
                    setAllCountriesTimeSlot(value);
                    // 重新加载该表格数据
                    const startTime = dateRange[0].format(
                      'YYYY-MM-DD HH:mm:ss',
                    );
                    const endTime = dateRange[1].format('YYYY-MM-DD HH:mm:ss');
                    getAllCountriesSummary({
                      startTime,
                      endTime,
                      timeSlotGranularity: value,
                    }).then((result: any) => {
                      const payload =
                        unwrapAnalyticsResponse<API.AllCountriesSummary | null>(
                          result,
                          null,
                        );
                      setAllCountriesSummary(payload.data);
                    });
                  }}
                >
                  <Select.Option value="hour">按小时</Select.Option>
                  <Select.Option value="day">按天</Select.Option>
                </Select>
              </Space>
            }
          >
            {allCountriesSummary ? (
              <Table
                dataSource={[allCountriesSummary]}
                pagination={false}
                columns={[
                  {
                    title: '时间段',
                    dataIndex: 'timeRange',
                    key: 'timeRange',
                  },
                  {
                    title: '总监控时长',
                    dataIndex: 'totalDurationHours',
                    key: 'totalDurationHours',
                    align: 'right',
                    render: (value: number) => formatHours(value),
                  },
                  ...durationSummaryRateColumns,
                ]}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 40 }}>暂无数据</div>
            )}
          </Card>
        </Col>

        {/* 美国/欧洲表格 */}
        <Col span={24} style={{ marginTop: 16 }}>
          <Card
            title="美国/欧洲时长汇总表（含英德法西意）"
            loading={loading}
            extra={
              <Space>
                <span>时间槽粒度：</span>
                <Select
                  style={{ width: 120 }}
                  value={regionTimeSlot}
                  onChange={(value) => {
                    setRegionTimeSlot(value);
                    // 重新加载该表格数据
                    const startTime = dateRange[0].format(
                      'YYYY-MM-DD HH:mm:ss',
                    );
                    const endTime = dateRange[1].format('YYYY-MM-DD HH:mm:ss');
                    getRegionSummary({
                      startTime,
                      endTime,
                      timeSlotGranularity: value,
                    }).then((result: any) => {
                      const payload = unwrapAnalyticsResponse<
                        API.RegionSummary[]
                      >(result, []);
                      setRegionSummary(payload.data);
                    });
                  }}
                >
                  <Select.Option value="hour">按小时</Select.Option>
                  <Select.Option value="day">按天</Select.Option>
                </Select>
              </Space>
            }
          >
            {regionSummary.length > 0 ? (
              <Table
                dataSource={regionSummary}
                pagination={false}
                rowKey="regionCode"
                columns={[
                  {
                    title: '区域',
                    dataIndex: 'region',
                    key: 'region',
                    render: (text: string, record: API.RegionSummary) => (
                      <Tag
                        color={
                          record.regionCode === 'US'
                            ? 'blue'
                            : record.regionCode === 'EU_TOTAL'
                            ? 'green'
                            : 'orange'
                        }
                      >
                        {text}
                      </Tag>
                    ),
                  },
                  {
                    title: '时间段',
                    dataIndex: 'timeRange',
                    key: 'timeRange',
                  },
                  {
                    title: '总监控时长',
                    dataIndex: 'totalDurationHours',
                    key: 'totalDurationHours',
                    align: 'right',
                    render: (value: number) => formatHours(value),
                  },
                  ...durationSummaryRateColumns,
                ]}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 40 }}>暂无数据</div>
            )}
          </Card>
        </Col>

        {/* 周期汇总表格 */}
        <Col span={24} style={{ marginTop: 16 }}>
          <Card
            title="周期时长汇总表"
            loading={loading}
            extra={
              <Space>
                <Select
                  style={{ width: 120 }}
                  placeholder="国家"
                  allowClear
                  value={periodFilter.country}
                  onChange={(value) =>
                    setPeriodFilter({ ...periodFilter, country: value })
                  }
                >
                  {Object.entries(countryMap).map(([key, value]) => (
                    <Select.Option key={key} value={key}>
                      {value}
                    </Select.Option>
                  ))}
                </Select>
                <Input
                  style={{ width: 150 }}
                  placeholder="站点"
                  allowClear
                  value={periodFilter.site}
                  onChange={(e) =>
                    setPeriodFilter({ ...periodFilter, site: e.target.value })
                  }
                />
                <Input
                  style={{ width: 150 }}
                  placeholder="品牌"
                  allowClear
                  value={periodFilter.brand}
                  onChange={(e) =>
                    setPeriodFilter({ ...periodFilter, brand: e.target.value })
                  }
                />
                <span>时间槽粒度：</span>
                <Select
                  style={{ width: 120 }}
                  value={periodTimeSlot}
                  onChange={(value) => {
                    setPeriodTimeSlot(value);
                    void loadPeriodSummaryTable(
                      periodSummary.current,
                      periodSummary.pageSize,
                      periodFilter,
                      value,
                    );
                  }}
                >
                  <Select.Option value="hour">按小时</Select.Option>
                  <Select.Option value="day">按天</Select.Option>
                </Select>
                <Button
                  type="primary"
                  onClick={handleRefreshAll}
                  loading={loading}
                >
                  查询
                </Button>
              </Space>
            }
          >
            {periodSummary.list.length > 0 ? (
              <Table
                dataSource={periodSummary.list}
                pagination={{
                  current: periodSummary.current,
                  pageSize: periodSummary.pageSize,
                  total: periodSummary.total,
                  showSizeChanger: true,
                  showTotal: (total) => `共 ${total} 条`,
                  onChange: (page, size) => {
                    const newSummary = {
                      ...periodSummary,
                      current: page,
                      pageSize: size || 10,
                    };
                    setPeriodSummary(newSummary);
                    void loadPeriodSummaryTable(
                      page,
                      size || 10,
                      periodFilter,
                      periodTimeSlot,
                    );
                  },
                }}
                rowKey={(record, index) =>
                  `${record.timeRange}_${record.country}_${record.site}_${record.brand}_${index}`
                }
                columns={[
                  {
                    title: '时间槽',
                    dataIndex: 'timeRange',
                    key: 'timeRange',
                  },
                  {
                    title: '国家',
                    dataIndex: 'country',
                    key: 'country',
                    render: (text: string) =>
                      text ? countryMap[text] || text : '-',
                  },
                  {
                    title: '站点',
                    dataIndex: 'site',
                    key: 'site',
                    render: (text: string) => text || '-',
                  },
                  {
                    title: '品牌',
                    dataIndex: 'brand',
                    key: 'brand',
                    render: (text: string) => text || '-',
                  },
                  {
                    title: '总监控时长',
                    dataIndex: 'totalDurationHours',
                    key: 'totalDurationHours',
                    align: 'right',
                    render: (value: number) => formatHours(value),
                  },
                  ...durationSummaryRateColumns,
                ]}
                expandable={{
                  expandedRowRender: renderPeriodTimeSlotDetails,
                  rowExpandable: (record) =>
                    Boolean(record.timeSlotDetails?.length),
                }}
                scroll={{ x: 1400 }}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: 40 }}>暂无数据</div>
            )}
          </Card>
        </Col>
      </Row>
    </PageContainer>
  );
};

export default AnalyticsPageContent;
