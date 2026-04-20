import analyticsServices from '@/services/analytics';
import services from '@/services/asin';
import { formatBeijingNow, toBeijingDayjs } from '@/utils/beijingTime';
import { debugError, debugLog } from '@/utils/debug';
import { exportToExcel } from '@/utils/export';
import { DownloadOutlined, DownOutlined } from '@ant-design/icons';
import {
  ActionType,
  PageContainer,
  ProColumns,
  ProFormInstance,
  ProTable,
  StatisticCard,
} from '@ant-design/pro-components';
import { useSearchParams } from '@umijs/max';
import type { TableProps } from 'antd';
import { Button, Card, Dropdown, message, Space, Table, Tag } from 'antd';
import React, { useEffect, useMemo, useRef, useState } from 'react';

const { queryMonitorHistory, getAbnormalDurationStatistics } =
  services.MonitorController;
const { getMonitorHistoryPeakHours, getMonitorHistorySummary } =
  analyticsServices.AnalyticsController;

// 国家选项映射
const countryMap: Record<
  string,
  { text: string; color: string; region: string }
> = {
  US: { text: '美国', color: 'blue', region: 'US' },
  UK: { text: '英国', color: 'green', region: 'EU' },
  DE: { text: '德国', color: 'orange', region: 'EU' },
  FR: { text: '法国', color: 'purple', region: 'EU' },
  IT: { text: '意大利', color: 'cyan', region: 'EU' },
  ES: { text: '西班牙', color: 'magenta', region: 'EU' },
};

interface AbnormalDurationSummaryRow {
  key: string;
  asin: string;
  country: string;
  queryTimeRange: string;
  abnormalCount: number;
  averageAbnormalDuration: number;
  minAbnormalDuration: number;
  maxAbnormalDuration: number;
  maxAbnormalTime: string;
}

interface AbnormalDurationSummaryAccumulator {
  key: string;
  asin: string;
  country: string;
  queryTimeRange: string;
  abnormalCount: number;
  totalAbnormalDuration: number;
  minAbnormalDuration: number;
  maxAbnormalDuration: number;
  maxAbnormalTime: string;
}

const formatDuration = (value: number) => `${value.toFixed(2)} 小时`;

const toCsvCell = (value: unknown): string => {
  const raw = String(value ?? '');
  return `"${raw.replace(/"/g, '""')}"`;
};

const MonitorHistoryPage: React.FC<unknown> = () => {
  const actionRef = useRef<ActionType | null>(null);
  const formRef = useRef<ProFormInstance | undefined>(undefined);
  const [searchParams] = useSearchParams();
  const [statistics, setStatistics] = useState<API.MonitorStatistics>({});
  const [peakHoursStatistics, setPeakHoursStatistics] =
    useState<API.PeakHoursStatistics>({});
  const [selectedCountry, setSelectedCountry] = useState<string>('');
  const [selectedCheckType, setSelectedCheckType] = useState<string>('');
  const [abnormalDurationData, setAbnormalDurationData] =
    useState<API.AbnormalDurationStatistics | null>(null);
  const [showAbnormalDurationTable, setShowAbnormalDurationTable] =
    useState(false);
  const [abnormalDurationQueryRange, setAbnormalDurationQueryRange] = useState<{
    startTime: string;
    endTime: string;
  } | null>(null);
  // 保存当前的查询参数，用于导出
  const currentQueryParamsRef = useRef<Record<string, any>>({});

  // 从URL参数获取筛选条件
  const type = searchParams.get('type') || '';
  const id = searchParams.get('id') || '';

  const abnormalDurationSummaryData = useMemo<
    AbnormalDurationSummaryRow[]
  >(() => {
    if (!abnormalDurationData) {
      return [];
    }

    const backendSummary = Array.isArray(abnormalDurationData.summary)
      ? abnormalDurationData.summary
      : [];
    if (backendSummary.length > 0) {
      const fallbackQueryTimeRange =
        abnormalDurationQueryRange?.startTime &&
        abnormalDurationQueryRange.endTime
          ? `${abnormalDurationQueryRange.startTime} ~ ${abnormalDurationQueryRange.endTime}`
          : '-';

      return backendSummary
        .map((item, index) => ({
          key:
            item.key ||
            `${item.asin || 'unknown'}-${item.country || ''}-${index}`,
          asin: item.asin || '-',
          country: item.country || '',
          queryTimeRange: item.queryTimeRange || fallbackQueryTimeRange,
          abnormalCount: Number(item.abnormalCount || 0),
          averageAbnormalDuration: Number(item.averageAbnormalDuration || 0),
          minAbnormalDuration: Number(item.minAbnormalDuration || 0),
          maxAbnormalDuration: Number(item.maxAbnormalDuration || 0),
          maxAbnormalTime: item.maxAbnormalTime || '-',
        }))
        .sort((a, b) => {
          if (b.abnormalCount !== a.abnormalCount) {
            return b.abnormalCount - a.abnormalCount;
          }
          return b.maxAbnormalDuration - a.maxAbnormalDuration;
        });
    }

    if (!abnormalDurationData.data || abnormalDurationData.data.length === 0) {
      return [];
    }

    const queryTimeRange =
      abnormalDurationQueryRange?.startTime &&
      abnormalDurationQueryRange.endTime
        ? `${abnormalDurationQueryRange.startTime} ~ ${abnormalDurationQueryRange.endTime}`
        : '-';

    const summaryMap = new Map<string, AbnormalDurationSummaryAccumulator>();

    abnormalDurationData.data.forEach((item) => {
      if (!item.asin && !item.asinId) {
        return;
      }

      const asin = item.asin || `ASIN-${item.asinId}`;
      const country = item.country || '';
      const key = `${item.asinId || asin}-${country}`;

      if (!summaryMap.has(key)) {
        summaryMap.set(key, {
          key,
          asin,
          country,
          queryTimeRange,
          abnormalCount: 0,
          totalAbnormalDuration: 0,
          minAbnormalDuration: Number.POSITIVE_INFINITY,
          maxAbnormalDuration: 0,
          maxAbnormalTime: '-',
        });
      }

      const summary = summaryMap.get(key)!;
      const brokenCount = Number(item.brokenCount || 0);
      const abnormalDuration = Number(item.abnormalDuration || 0);

      summary.abnormalCount += brokenCount;
      summary.totalAbnormalDuration += abnormalDuration;

      if (brokenCount > 0 && abnormalDuration > 0) {
        const perAbnormalDuration = abnormalDuration / brokenCount;
        summary.minAbnormalDuration = Math.min(
          summary.minAbnormalDuration,
          perAbnormalDuration,
        );

        if (perAbnormalDuration > summary.maxAbnormalDuration) {
          summary.maxAbnormalDuration = perAbnormalDuration;
          summary.maxAbnormalTime = item.timePeriod || '-';
        }
      }
    });

    return Array.from(summaryMap.values())
      .map((item) => {
        const avgDuration =
          item.abnormalCount > 0
            ? item.totalAbnormalDuration / item.abnormalCount
            : 0;
        const minDuration = Number.isFinite(item.minAbnormalDuration)
          ? item.minAbnormalDuration
          : 0;

        return {
          key: item.key,
          asin: item.asin,
          country: item.country,
          queryTimeRange: item.queryTimeRange,
          abnormalCount: item.abnormalCount,
          averageAbnormalDuration: Number(avgDuration.toFixed(2)),
          minAbnormalDuration: Number(minDuration.toFixed(2)),
          maxAbnormalDuration: Number(item.maxAbnormalDuration.toFixed(2)),
          maxAbnormalTime: item.maxAbnormalTime,
        };
      })
      .sort((a, b) => {
        if (b.abnormalCount !== a.abnormalCount) {
          return b.abnormalCount - a.abnormalCount;
        }
        return b.maxAbnormalDuration - a.maxAbnormalDuration;
      });
  }, [abnormalDurationData, abnormalDurationQueryRange]);

  const abnormalDurationColumns: TableProps<AbnormalDurationSummaryRow>['columns'] =
    [
      {
        title: 'ASIN',
        dataIndex: 'asin',
        width: 180,
        render: (value: string) => value || '-',
      },
      {
        title: '国家',
        dataIndex: 'country',
        width: 110,
        render: (value: string) => {
          const countryInfo = value ? countryMap[value] : undefined;
          if (countryInfo) {
            return <Tag color={countryInfo.color}>{countryInfo.text}</Tag>;
          }
          return value || '-';
        },
      },
      {
        title: '查询时间段',
        dataIndex: 'queryTimeRange',
        width: 340,
      },
      {
        title: '异常次数',
        dataIndex: 'abnormalCount',
        width: 100,
      },
      {
        title: '平均异常时长',
        dataIndex: 'averageAbnormalDuration',
        width: 140,
        render: (value: number) => formatDuration(value || 0),
      },
      {
        title: '最短异常时长',
        dataIndex: 'minAbnormalDuration',
        width: 140,
        render: (value: number) => formatDuration(value || 0),
      },
      {
        title: '最长异常时长',
        dataIndex: 'maxAbnormalDuration',
        width: 140,
        render: (value: number) => formatDuration(value || 0),
      },
      {
        title: '最长异常时间',
        dataIndex: 'maxAbnormalTime',
        width: 180,
      },
    ];

  const handleExportAbnormalDuration = async () => {
    try {
      if (!abnormalDurationSummaryData.length) {
        message.warning('暂无可导出的异常时长统计数据');
        return;
      }

      const headers = [
        'ASIN',
        '国家',
        '查询时间段',
        '异常次数',
        '平均异常时长',
        '最短异常时长',
        '最长异常时长',
        '最长异常时间',
      ];

      const rows = abnormalDurationSummaryData.map((item) => [
        item.asin,
        countryMap[item.country]?.text || item.country || '-',
        item.queryTimeRange || '-',
        String(item.abnormalCount ?? 0),
        formatDuration(item.averageAbnormalDuration || 0),
        formatDuration(item.minAbnormalDuration || 0),
        formatDuration(item.maxAbnormalDuration || 0),
        item.maxAbnormalTime || '-',
      ]);

      const csvContent = [
        headers.map((item) => toCsvCell(item)).join(','),
        ...rows.map((row) => row.map((item) => toCsvCell(item)).join(',')),
      ].join('\r\n');

      const rangeText =
        abnormalDurationQueryRange?.startTime &&
        abnormalDurationQueryRange?.endTime
          ? `${abnormalDurationQueryRange.startTime}_${abnormalDurationQueryRange.endTime}`
          : formatBeijingNow('YYYY-MM-DD_HH-mm-ss');

      const safeRangeText = rangeText.replace(/[\\/:*?"<>|\s]+/g, '-');
      const filename = `异常时长统计_${safeRangeText}.csv`;

      const blob = new Blob([`\uFEFF${csvContent}`], {
        type: 'text/csv;charset=utf-8;',
      });
      const downloadURL = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadURL;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadURL);
      message.success('异常时长统计导出成功');
    } catch (error) {
      debugError('导出异常时长统计失败:', error);
      message.error('导出失败，请重试');
    }
  };

  // 加载统计信息
  const loadStatistics = async (country?: string) => {
    try {
      const params: any = {};
      if (type === 'group' && id) {
        params.variantGroupId = id;
      } else if (type === 'asin' && id) {
        params.asinId = id;
      }
      const statisticsResponse = await getMonitorHistorySummary(params);
      setStatistics(statisticsResponse?.data || {});

      // 如果有国家筛选，加载高峰期统计
      const countryToUse = country || selectedCountry;
      if (countryToUse) {
        try {
          const peakData = await getMonitorHistoryPeakHours({
            country: countryToUse,
          });
          const peakStats = peakData?.data || {};
          setPeakHoursStatistics(peakStats);
        } catch (error) {
          debugError('加载高峰期统计失败:', error);
        }
      } else {
        setPeakHoursStatistics({});
      }
    } catch (error) {
      debugError('加载统计信息失败:', error);
    }
  };

  useEffect(() => {
    loadStatistics();
  }, [type, id]);

  const columns: ProColumns<API.MonitorHistory>[] = [
    {
      title: '检查时间',
      dataIndex: 'checkTime',
      width: 180,
      valueType: 'dateTimeRange',
      hideInTable: true,
      fieldProps: {
        style: { width: '100%', minWidth: 380 },
        placeholder: ['开始时间', '结束时间'],
        format: 'YYYY-MM-DD HH:mm',
        showTime: { format: 'HH:mm' },
      },
      colSize: 2,
      search: {
        transform: (value: any) => {
          debugLog('时间范围transform被调用，value:', value);
          if (value && Array.isArray(value) && value.length === 2) {
            const start = value[0] ? toBeijingDayjs(value[0]) : null;
            const end = value[1] ? toBeijingDayjs(value[1]) : null;
            const result = {
              startTime: start
                ? start.format('YYYY-MM-DD HH:mm:ss')
                : undefined,
              endTime: end ? end.format('YYYY-MM-DD HH:mm:ss') : undefined,
            };
            debugLog('时间范围transform返回:', result);
            return result;
          }
          debugLog('时间范围transform返回空对象（没有选择时间范围）');
          return {};
        },
      },
    },
    {
      title: '检查时间',
      dataIndex: 'checkTime',
      width: 180,
      valueType: 'dateTime',
      hideInSearch: true,
      sorter: true,
    },
    {
      title: '检查类型',
      dataIndex: 'checkType',
      width: 100,
      valueType: 'select' as const,
      valueEnum: {
        GROUP: { text: '变体组', status: 'Default' },
        ASIN: { text: 'ASIN', status: 'Processing' },
      },
      fieldProps: {
        onChange: (value: string) => {
          setSelectedCheckType(value || '');
          if (value === 'GROUP') {
            formRef.current?.setFieldsValue({
              asin: undefined,
              asinName: undefined,
              asinType: undefined,
            });
          } else if (value === 'ASIN') {
            formRef.current?.setFieldsValue({
              variantGroupName: undefined,
            });
          }
        },
      },
      render: (_: any, record: API.MonitorHistory) => (
        <Tag color={record.checkType === 'GROUP' ? 'blue' : 'default'}>
          {record.checkType === 'GROUP' ? '变体组' : 'ASIN'}
        </Tag>
      ),
    },
    {
      title: '变体组',
      dataIndex: 'variantGroupName',
      width: 200,
      hideInSearch: selectedCheckType === 'ASIN',
      renderText: (text) => text || '-',
    },
    {
      title: 'ASIN',
      dataIndex: 'asin',
      width: 150,
      hideInTable: type === 'group', // 如果是从变体组查看，隐藏ASIN列
      hideInSearch: selectedCheckType === 'GROUP',
      renderText: (text) => text || '-',
      fieldProps: {
        placeholder: '请输入ASIN编码，多个ASIN用空格分隔',
      },
      search: {
        transform: (value: any) => {
          if (!value || typeof value !== 'string') {
            return {};
          }
          // 按空格分割，去除空字符串
          const asinList = value
            .trim()
            .split(/\s+/)
            .filter((asin) => asin.length > 0);

          if (asinList.length === 0) {
            return {};
          }

          // 如果只有一个ASIN，保持原有逻辑（向后兼容）
          if (asinList.length === 1) {
            return { asin: asinList[0] };
          }

          // 多个ASIN用逗号分隔传递给后端
          return { asin: asinList.join(',') };
        },
      },
    },
    {
      title: 'ASIN名称',
      dataIndex: 'asinName',
      width: 250,
      hideInTable: type === 'group',
      hideInSearch: selectedCheckType === 'GROUP',
      renderText: (text) => text || '-',
    },
    {
      title: 'ASIN类型',
      dataIndex: 'asinType',
      width: 100,
      hideInTable: type === 'group',
      hideInSearch: selectedCheckType === 'GROUP',
      valueType: 'select' as const,
      valueEnum: {
        '1': { text: '主链', status: 'Success' },
        '2': { text: '副评', status: 'Default' },
      },
      render: (_: any, record: API.MonitorHistory) => {
        if (!record.asinType) return '-';
        // 将后端格式(1/2)转换为前端显示格式(主链/副评)
        // 兼容旧格式 MAIN_LINK/SUB_REVIEW
        const normalizedType =
          record.asinType === 'MAIN_LINK'
            ? '1'
            : record.asinType === 'SUB_REVIEW'
            ? '2'
            : record.asinType;
        const typeMap: Record<string, { text: string; color: string }> = {
          '1': { text: '主链', color: 'green' },
          '2': { text: '副评', color: 'blue' },
        };
        const typeInfo = typeMap[normalizedType];
        return typeInfo ? (
          <Tag color={typeInfo.color}>{typeInfo.text}</Tag>
        ) : (
          normalizedType
        );
      },
    },
    {
      title: '所属国家',
      dataIndex: 'country',
      width: 120,
      valueType: 'select' as const,
      valueEnum: Object.keys(countryMap).reduce((acc, key) => {
        acc[key] = { text: countryMap[key].text };
        return acc;
      }, {} as Record<string, { text: string }>),
      render: (_: any, record: API.MonitorHistory) => {
        const country = record.country || '';
        const countryInfo = countryMap[country];
        return countryInfo ? (
          <Tag color={countryInfo.color}>{countryInfo.text}</Tag>
        ) : (
          '-'
        );
      },
    },
    {
      title: '检查结果',
      dataIndex: 'isBroken',
      width: 120,
      valueType: 'select' as const,
      valueEnum: {
        '0': { text: '正常', status: 'Success' },
        '1': { text: '异常', status: 'Error' },
      },
      render: (_: any, record: API.MonitorHistory) => {
        const isBroken = record.isBroken === 1;
        return (
          <Tag color={isBroken ? 'error' : 'success'}>
            {isBroken ? '异常' : '正常'}
          </Tag>
        );
      },
    },
    {
      title: '通知状态',
      dataIndex: 'notificationSent',
      width: 100,
      hideInSearch: true,
      render: (_: any, record: API.MonitorHistory) => (
        <Tag color={record.notificationSent === 1 ? 'success' : 'default'}>
          {record.notificationSent === 1 ? '已通知' : '未通知'}
        </Tag>
      ),
    },
  ];

  return (
    <PageContainer
      header={{
        title: '监控历史',
        breadcrumb: {},
      }}
    >
      {/* 统计卡片 */}
      <Space
        direction="vertical"
        size="large"
        style={{ width: '100%', marginBottom: 16 }}
      >
        <StatisticCard.Group>
          <StatisticCard
            statistic={{
              title: '总检查次数',
              value: statistics.totalChecks || 0,
            }}
          />
          <StatisticCard
            statistic={{
              title: '正常次数',
              value: statistics.normalCount || 0,
              status: 'success',
            }}
          />
          <StatisticCard
            statistic={{
              title: '异常次数',
              value: statistics.brokenCount || 0,
              status: 'error',
            }}
          />
          <StatisticCard
            statistic={{
              title: '监控对象数',
              value: (statistics.groupCount || 0) + (statistics.asinCount || 0),
            }}
          />
          {selectedCountry && peakHoursStatistics.peakTotal !== undefined && (
            <>
              <StatisticCard
                statistic={{
                  title: '高峰期异常率',
                  value: peakHoursStatistics.peakTotal
                    ? `${(peakHoursStatistics.peakRate || 0).toFixed(2)}%`
                    : '0%',
                  description: `高峰期: ${
                    peakHoursStatistics.peakBroken || 0
                  }/${peakHoursStatistics.peakTotal || 0}`,
                }}
              />
              <StatisticCard
                statistic={{
                  title: '低峰期异常率',
                  value: peakHoursStatistics.offPeakTotal
                    ? `${(peakHoursStatistics.offPeakRate || 0).toFixed(2)}%`
                    : '0%',
                  description: `低峰期: ${
                    peakHoursStatistics.offPeakBroken || 0
                  }/${peakHoursStatistics.offPeakTotal || 0}`,
                }}
              />
            </>
          )}
        </StatisticCard.Group>
      </Space>

      <ProTable<API.MonitorHistory>
        headerTitle="监控历史记录"
        actionRef={actionRef}
        formRef={formRef}
        rowKey="id"
        search={{
          labelWidth: 100,
          defaultCollapsed: false,
        }}
        request={async (params, sorter) => {
          debugLog('ProTable request params:', params);
          debugLog('params中的所有键:', Object.keys(params));

          const requestParams: any = {
            current: params.current || 1,
            pageSize: params.pageSize || 10,
          };

          // 处理时间范围（transform 函数已经转换为 startTime 和 endTime）
          // 注意：transform返回的值会合并到params中
          // 但是，如果用户没有选择时间范围，checkTime字段可能不存在或为空
          const timeStart = params.startTime;
          const timeEnd = params.endTime;

          debugLog('时间范围检查:', {
            timeStart,
            timeEnd,
            checkTime: params.checkTime,
          });

          if (timeStart) {
            requestParams.startTime = timeStart;
          }
          if (timeEnd) {
            requestParams.endTime = timeEnd;
          }

          debugLog('处理后的requestParams:', requestParams);

          // 处理其他筛选条件
          if (params.country) {
            requestParams.country = params.country;
            setSelectedCountry(params.country);
          } else {
            setSelectedCountry('');
          }
          if (params.checkType) {
            requestParams.checkType = params.checkType;
          }
          const isGroupType = params.checkType === 'GROUP';
          const isAsinType = params.checkType === 'ASIN';
          if (params.isBroken !== undefined && params.isBroken !== '') {
            requestParams.isBroken = params.isBroken;
          }
          if (!isAsinType && params.variantGroupName) {
            requestParams.variantGroupName = params.variantGroupName;
          }
          if (!isGroupType && params.asinName) {
            requestParams.asinName = params.asinName;
          }
          if (!isGroupType && params.asinType) {
            requestParams.asinType = params.asinType;
          }
          // 处理ASIN搜索
          if (!isGroupType && params.asin) {
            requestParams.asin = params.asin;
            debugLog('ASIN筛选参数:', params.asin);
          }

          // 如果URL中有参数，添加到请求中
          if (type === 'group' && id) {
            requestParams.variantGroupId = id;
          } else if (type === 'asin' && id) {
            requestParams.asinId = id;
          }

          // 保存当前查询参数到 ref，用于导出
          // 只保存筛选条件，不保存分页和排序参数
          // 只保存有值的参数，避免传递 undefined
          const paramsToSave: Record<string, any> = {};
          if (requestParams.startTime)
            paramsToSave.startTime = requestParams.startTime;
          if (requestParams.endTime)
            paramsToSave.endTime = requestParams.endTime;
          if (requestParams.country)
            paramsToSave.country = requestParams.country;
          if (requestParams.checkType)
            paramsToSave.checkType = requestParams.checkType;
          if (
            requestParams.isBroken !== undefined &&
            requestParams.isBroken !== ''
          ) {
            paramsToSave.isBroken = requestParams.isBroken;
          }
          if (requestParams.variantGroupName) {
            paramsToSave.variantGroupName = requestParams.variantGroupName;
          }
          if (requestParams.asinName) {
            paramsToSave.asinName = requestParams.asinName;
          }
          if (requestParams.asinType) {
            paramsToSave.asinType = requestParams.asinType;
          }
          if (requestParams.asin) paramsToSave.asin = requestParams.asin;
          if (requestParams.variantGroupId)
            paramsToSave.variantGroupId = requestParams.variantGroupId;
          if (requestParams.asinId) paramsToSave.asinId = requestParams.asinId;
          currentQueryParamsRef.current = paramsToSave;

          // 处理排序
          if (sorter && Object.keys(sorter).length > 0) {
            // 这里可以根据需要处理排序逻辑
          }

          const { data, success } = await queryMonitorHistory(requestParams);

          // 如果筛选了国家，加载高峰期统计
          if (params.country) {
            loadStatistics(params.country);
          } else {
            setPeakHoursStatistics({});
          }

          // 检查是否需要加载异常时长统计
          const hasAsinFilter = Boolean(params.asin || (type === 'asin' && id));
          const hasGroupFilter = Boolean(
            (type === 'group' && id) ||
              String(params.variantGroupName || '').trim(),
          );

          // 获取时间范围
          // transform函数会将checkTime转换为startTime和endTime
          // 但需要检查params中是否有这些值
          const statsStartTime = params.startTime || requestParams.startTime;
          const statsEndTime = params.endTime || requestParams.endTime;

          debugLog('检查异常时长统计表显示条件:', {
            hasAsinFilter,
            hasGroupFilter,
            statsStartTime,
            statsEndTime,
            asinValue: params.asin,
            paramsKeys: Object.keys(params),
            hasStartTime: !!params.startTime,
            hasEndTime: !!params.endTime,
            hasCheckTime: !!params.checkTime,
            checkTimeValue: params.checkTime,
          });

          if (
            (hasAsinFilter || hasGroupFilter) &&
            statsStartTime &&
            statsEndTime
          ) {
            try {
              const statsParams: any = {
                startTime: statsStartTime,
                endTime: statsEndTime,
                includeSeries: '0',
              };

              if (params.country || requestParams.country) {
                statsParams.country = params.country || requestParams.country;
              }

              if (hasGroupFilter) {
                if (type === 'group' && id) {
                  statsParams.variantGroupId = id;
                }
              }

              if (hasAsinFilter) {
                // 从筛选条件中提取ASIN ID或编码
                if (type === 'asin' && id) {
                  // 从URL参数来的，是ASIN ID
                  statsParams.asinIds = [id];
                  debugLog('使用URL参数中的ASIN ID:', id);
                } else if (params.asin) {
                  // 从搜索框来的，可能是ASIN编码
                  // transform函数处理：
                  // - 单个ASIN：返回 { asin: 'ASIN001' }
                  // - 多个ASIN：返回 { asin: 'ASIN001,ASIN002' }
                  const asinValue = String(params.asin).trim();
                  debugLog('从搜索框获取ASIN值:', asinValue);

                  if (asinValue) {
                    // 检查是否包含逗号（多个ASIN）
                    const asinList = asinValue.includes(',')
                      ? asinValue
                          .split(',')
                          .map((s: string) => s.trim())
                          .filter((s: string) => s.length > 0)
                      : [asinValue].filter((s: string) => s.length > 0);

                    debugLog('解析后的ASIN列表:', asinList);

                    if (asinList.length > 0) {
                      statsParams.asinCodes = asinList;
                      debugLog('设置asinCodes参数:', statsParams.asinCodes);
                    }
                  }
                }
              }

              if (params.variantGroupName || requestParams.variantGroupName) {
                statsParams.variantGroupName =
                  params.variantGroupName || requestParams.variantGroupName;
              }
              if (params.asinName || requestParams.asinName) {
                statsParams.asinName =
                  params.asinName || requestParams.asinName;
              }
              if (params.asinType || requestParams.asinType) {
                statsParams.asinType =
                  params.asinType || requestParams.asinType;
              }

              if (
                statsParams.variantGroupId ||
                statsParams.variantGroupName ||
                statsParams.asinIds ||
                statsParams.asinCodes
              ) {
                debugLog('加载异常时长统计，参数:', statsParams);
                const statsResult = await getAbnormalDurationStatistics(
                  statsParams,
                );
                debugLog('异常时长统计结果:', statsResult);

                // 检查返回的数据结构
                if (statsResult?.data) {
                  const statsData = statsResult.data;
                  const summaryList = Array.isArray(statsData.summary)
                    ? statsData.summary
                    : [];
                  const seriesList = Array.isArray(statsData.data)
                    ? statsData.data
                    : [];

                  const hasValidSummary = summaryList.some(
                    (item) => item?.asin || item?.abnormalCount,
                  );
                  const hasValidSeries = seriesList.some(
                    (item) => item?.asin || item?.asinId,
                  );

                  if (hasValidSummary || hasValidSeries) {
                    setAbnormalDurationData(statsData);
                    setShowAbnormalDurationTable(true);
                    setAbnormalDurationQueryRange({
                      startTime: statsStartTime,
                      endTime: statsEndTime,
                    });
                    debugLog('异常时长统计表数据已设置，显示表格');
                  } else {
                    debugLog('统计数据为空，隐藏异常时长统计表');
                    setShowAbnormalDurationTable(false);
                    setAbnormalDurationData(null);
                    setAbnormalDurationQueryRange(null);
                  }
                } else {
                  debugLog('统计结果为空，隐藏异常时长统计表');
                  setShowAbnormalDurationTable(false);
                  setAbnormalDurationData(null);
                  setAbnormalDurationQueryRange(null);
                }
              } else {
                debugLog('缺少必要的筛选参数，隐藏异常时长统计表');
                setShowAbnormalDurationTable(false);
                setAbnormalDurationData(null);
                setAbnormalDurationQueryRange(null);
              }
            } catch (error) {
              debugError('加载异常时长统计失败:', error);
              setShowAbnormalDurationTable(false);
              setAbnormalDurationData(null);
              setAbnormalDurationQueryRange(null);
            }
          } else {
            debugLog('不满足异常时长统计表显示条件，隐藏表格');
            setShowAbnormalDurationTable(false);
            setAbnormalDurationData(null);
            setAbnormalDurationQueryRange(null);
          }

          return {
            data: data?.list || [],
            success,
            total: data?.total || 0,
          };
        }}
        columns={columns}
        pagination={{
          defaultPageSize: 10,
          showSizeChanger: true,
          showQuickJumper: true,
          showTotal: (total, range) =>
            `第 ${range[0]}-${range[1]} 条/总共 ${total} 条`,
          pageSizeOptions: ['10', '20', '50', '100'],
        }}
        toolBarRender={() => {
          const handleExport = async (
            exportType: 'records' | 'statusChanges',
          ) => {
            try {
              // 直接使用保存的查询参数，确保导出时使用的筛选条件与查询时完全一致
              const savedParams = currentQueryParamsRef.current;

              // 构建查询参数对象，从保存的参数开始
              const queryParams: Record<string, any> = {
                ...savedParams,
              };

              // 如果URL中有参数，添加到请求中（确保这些参数始终存在）
              if (type === 'group' && id) {
                queryParams.variantGroupId = id;
              } else if (type === 'asin' && id) {
                queryParams.asinId = id;
              }

              debugLog('导出使用的查询参数（与查询时一致）:', queryParams);

              // 添加导出类型参数
              queryParams.exportType = exportType;

              const filename =
                exportType === 'statusChanges' ? '状态变动' : '监控历史';

              await exportToExcel(
                '/v1/export/monitor-history',
                queryParams,
                filename,
              );
            } catch (error) {
              debugError('导出失败:', error);
              message.error('导出失败，请重试');
            }
          };

          return [
            <Dropdown.Button
              key="export"
              type="primary"
              icon={<DownOutlined />}
              menu={{
                items: [
                  {
                    key: 'records',
                    label: '导出检查记录',
                    onClick: () => handleExport('records'),
                  },
                  {
                    key: 'statusChanges',
                    label: '导出状态变动',
                    onClick: () => handleExport('statusChanges'),
                  },
                ],
              }}
            >
              导出Excel
            </Dropdown.Button>,
          ];
        }}
      />

      {/* 异常时长统计表格 - 放在主表格下方 */}
      {showAbnormalDurationTable && abnormalDurationData && (
        <Card
          title="异常时长统计"
          style={{ marginTop: 16 }}
          extra={
            <Space size="small">
              <Button
                size="small"
                icon={<DownloadOutlined />}
                disabled={!abnormalDurationSummaryData.length}
                onClick={() => {
                  void handleExportAbnormalDuration();
                }}
              >
                导出数据
              </Button>
              <Tag>
                时间粒度:{' '}
                {abnormalDurationData.timeGranularity === 'hour'
                  ? '按小时'
                  : abnormalDurationData.timeGranularity === 'day'
                  ? '按天'
                  : '按周'}
              </Tag>
              <Tag>ASIN数: {abnormalDurationSummaryData.length}</Tag>
            </Space>
          }
        >
          <Table<AbnormalDurationSummaryRow>
            rowKey="key"
            columns={abnormalDurationColumns}
            dataSource={abnormalDurationSummaryData}
            scroll={{ x: 1450 }}
            pagination={{
              defaultPageSize: 10,
              showSizeChanger: true,
              showQuickJumper: true,
              showTotal: (total, range) =>
                `第 ${range[0]}-${range[1]} 条/总共 ${total} 条`,
              pageSizeOptions: ['10', '20', '50', '100'],
            }}
          />
        </Card>
      )}
    </PageContainer>
  );
};

export default MonitorHistoryPage;
