import services from '@/services/asin';
import { useMessage } from '@/utils/message';
import {
  ActionType,
  PageContainer,
  ProColumns,
  ProTable,
  StatisticCard,
} from '@ant-design/pro-components';
import { useSearchParams } from '@umijs/max';
import { Button, Card, Space, Tag } from 'antd';
import dayjs from 'dayjs';
import ReactECharts from 'echarts-for-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';

const {
  queryMonitorHistory,
  getMonitorStatistics,
  getPeakHoursStatistics,
  getAbnormalDurationStatistics,
} = services.MonitorController;

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

// 异常时长统计图表组件
const AbnormalDurationChart: React.FC<{ data: any }> = ({ data }) => {
  const chartOption = useMemo(() => {
    if (!data || !data.data || data.data.length === 0) {
      return {
        title: {
          text: '暂无数据',
          left: 'center',
          top: 'middle',
          textStyle: {
            color: '#999',
          },
        },
      };
    }

    // 按ASIN分组数据
    const asinMap = new Map<string, any[]>();
    data.data.forEach((item: any) => {
      const asin = item.asin || `ASIN-${item.asinId}`;
      if (!asinMap.has(asin)) {
        asinMap.set(asin, []);
      }
      asinMap.get(asin)!.push(item);
    });

    // 获取所有时间点（去重并排序）
    const timeSet = new Set<string>();
    data.data.forEach((item: any) => {
      timeSet.add(item.timePeriod);
    });
    const timeList = Array.from(timeSet).sort();

    // 构建系列数据
    const series: any[] = [];
    const colors = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de'];
    let colorIndex = 0;

    asinMap.forEach((items, asin) => {
      const abnormalDurationData = timeList.map((time) => {
        const item = items.find((i) => i.timePeriod === time);
        return item ? item.abnormalDuration : 0;
      });

      const normalDurationData = timeList.map((time) => {
        const item = items.find((i) => i.timePeriod === time);
        if (item) {
          // 正常时长 = 总时长 - 异常时长
          const normalDuration =
            (item.totalDuration || 0) - (item.abnormalDuration || 0);
          return normalDuration > 0 ? normalDuration : 0;
        }
        return 0;
      });

      const color = colors[colorIndex % colors.length];
      const normalColor = colors[(colorIndex + 1) % colors.length];
      colorIndex += 2;

      // 异常时长系列
      series.push({
        name: `${asin} - 异常时长`,
        type: 'line',
        yAxisIndex: 0,
        data: abnormalDurationData,
        itemStyle: { color },
        lineStyle: { color },
        symbol: 'circle',
        symbolSize: 6,
      });

      // 正常时长系列
      series.push({
        name: `${asin} - 正常时长`,
        type: 'line',
        yAxisIndex: 0,
        data: normalDurationData,
        itemStyle: { color: normalColor },
        lineStyle: { color: normalColor, type: 'dotted' },
        symbol: 'rect',
        symbolSize: 6,
      });
    });

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
        },
        formatter: (params: any) => {
          let result = `<div style="margin-bottom: 4px;"><strong>${params[0].axisValue}</strong></div>`;
          params.forEach((param: any) => {
            const value = `${param.value} 小时`;
            result += `<div style="margin: 2px 0;">
              <span style="display:inline-block;width:10px;height:10px;background-color:${param.color};margin-right:5px;"></span>
              ${param.seriesName}: ${value}
            </div>`;
          });
          return result;
        },
      },
      legend: {
        data: Array.from(asinMap.keys())
          .map((asin) => [`${asin} - 异常时长`, `${asin} - 正常时长`])
          .flat(),
        bottom: 0,
        type: 'scroll',
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '15%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: timeList,
        axisLabel: {
          rotate: 45,
          interval: 'auto',
        },
      },
      yAxis: [
        {
          type: 'value',
          name: '时长（小时）',
          position: 'left',
          axisLabel: {
            formatter: '{value} h',
          },
        },
      ],
      series,
    };
  }, [data]);

  return (
    <ReactECharts
      option={chartOption}
      style={{ height: '400px', width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  );
};

const MonitorHistoryPage: React.FC<unknown> = () => {
  const message = useMessage();
  const actionRef = useRef<ActionType>();
  const [searchParams] = useSearchParams();
  const [statistics, setStatistics] = useState<API.MonitorStatistics>({});
  const [peakHoursStatistics, setPeakHoursStatistics] =
    useState<API.PeakHoursStatistics>({});
  const [selectedCountry, setSelectedCountry] = useState<string>('');
  const [abnormalDurationData, setAbnormalDurationData] = useState<any>(null);
  const [showChart, setShowChart] = useState(false);

  // 从URL参数获取筛选条件
  const type = searchParams.get('type') || '';
  const id = searchParams.get('id') || '';

  // 加载统计信息
  const loadStatistics = async (country?: string) => {
    try {
      const params: any = {};
      if (type === 'group' && id) {
        params.variantGroupId = id;
      } else if (type === 'asin' && id) {
        params.asinId = id;
      }
      const { data } = await getMonitorStatistics(params);
      setStatistics(data || {});

      // 如果有国家筛选，加载高峰期统计
      const countryToUse = country || selectedCountry;
      if (countryToUse) {
        try {
          const peakData = await getPeakHoursStatistics({
            country: countryToUse,
          });
          const peakStats =
            peakData && typeof peakData === 'object' && !('success' in peakData)
              ? peakData
              : (peakData as any)?.data || {};
          setPeakHoursStatistics(peakStats);
        } catch (error) {
          console.error('加载高峰期统计失败:', error);
        }
      } else {
        setPeakHoursStatistics({});
      }
    } catch (error) {
      console.error('加载统计信息失败:', error);
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
          console.log('时间范围transform被调用，value:', value);
          if (value && Array.isArray(value) && value.length === 2) {
            const start = value[0]
              ? dayjs.isDayjs(value[0])
                ? value[0]
                : dayjs(value[0])
              : null;
            const end = value[1]
              ? dayjs.isDayjs(value[1])
                ? value[1]
                : dayjs(value[1])
              : null;
            const result = {
              startTime: start
                ? start.format('YYYY-MM-DD HH:mm:ss')
                : undefined,
              endTime: end ? end.format('YYYY-MM-DD HH:mm:ss') : undefined,
            };
            console.log('时间范围transform返回:', result);
            return result;
          }
          console.log('时间范围transform返回空对象（没有选择时间范围）');
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
      render: (text: string) => text || '-',
    },
    {
      title: 'ASIN',
      dataIndex: 'asin',
      width: 150,
      hideInTable: type === 'group', // 如果是从变体组查看，隐藏ASIN列
      render: (text: string) => text || '-',
      fieldProps: {
        placeholder: '请输入ASIN编码，多个ASIN用空格分隔（最多5个）',
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

          // 验证最多5个ASIN
          if (asinList.length > 5) {
            message.warning('最多只能输入5个ASIN，已自动截取前5个');
            return { asin: asinList.slice(0, 5).join(',') };
          }

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
      render: (text: string) => text || '-',
    },
    {
      title: 'ASIN类型',
      dataIndex: 'asinType',
      width: 100,
      hideInTable: type === 'group',
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
        rowKey="id"
        search={{
          labelWidth: 100,
          defaultCollapsed: false,
        }}
        request={async (params, sorter) => {
          console.log('ProTable request params:', params);
          console.log('params中的所有键:', Object.keys(params));

          const requestParams: any = {
            current: params.current || 1,
            pageSize: params.pageSize || 10,
          };

          // 处理时间范围（transform 函数已经转换为 startTime 和 endTime）
          // 注意：transform返回的值会合并到params中
          // 但是，如果用户没有选择时间范围，checkTime字段可能不存在或为空
          const timeStart = params.startTime;
          const timeEnd = params.endTime;

          console.log('时间范围检查:', {
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

          console.log('处理后的requestParams:', requestParams);

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
          if (params.isBroken !== undefined && params.isBroken !== '') {
            requestParams.isBroken = params.isBroken;
          }
          // 处理ASIN搜索
          if (params.asin) {
            requestParams.asin = params.asin;
            console.log('ASIN筛选参数:', params.asin);
          }

          // 如果URL中有参数，添加到请求中
          if (type === 'group' && id) {
            requestParams.variantGroupId = id;
          } else if (type === 'asin' && id) {
            requestParams.asinId = id;
          }

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
          const hasAsinFilter = params.asin || (type === 'asin' && id);
          const hasGroupFilter = type === 'group' && id;

          // 获取时间范围
          // transform函数会将checkTime转换为startTime和endTime
          // 但需要检查params中是否有这些值
          const chartStartTime = params.startTime || requestParams.startTime;
          const chartEndTime = params.endTime || requestParams.endTime;

          console.log('检查图表显示条件:', {
            hasAsinFilter,
            hasGroupFilter,
            chartStartTime,
            chartEndTime,
            asinValue: params.asin,
            paramsKeys: Object.keys(params),
            hasStartTime: !!params.startTime,
            hasEndTime: !!params.endTime,
            hasCheckTime: !!params.checkTime,
            checkTimeValue: params.checkTime,
          });

          if (
            (hasAsinFilter || hasGroupFilter) &&
            chartStartTime &&
            chartEndTime
          ) {
            try {
              const statsParams: any = {
                startTime: chartStartTime,
                endTime: chartEndTime,
              };

              if (hasGroupFilter) {
                statsParams.variantGroupId = id;
              } else if (hasAsinFilter) {
                // 从筛选条件中提取ASIN ID或编码
                if (type === 'asin' && id) {
                  // 从URL参数来的，是ASIN ID
                  statsParams.asinIds = [id];
                  console.log('使用URL参数中的ASIN ID:', id);
                } else if (params.asin) {
                  // 从搜索框来的，可能是ASIN编码
                  // transform函数处理：
                  // - 单个ASIN：返回 { asin: 'ASIN001' }
                  // - 多个ASIN：返回 { asin: 'ASIN001,ASIN002' }
                  const asinValue = String(params.asin).trim();
                  console.log('从搜索框获取ASIN值:', asinValue);

                  if (asinValue) {
                    // 检查是否包含逗号（多个ASIN）
                    const asinList = asinValue.includes(',')
                      ? asinValue
                          .split(',')
                          .map((s: string) => s.trim())
                          .filter((s: string) => s.length > 0)
                      : [asinValue].filter((s: string) => s.length > 0);

                    console.log('解析后的ASIN列表:', asinList);

                    if (asinList.length > 0) {
                      statsParams.asinCodes = asinList;
                      console.log('设置asinCodes参数:', statsParams.asinCodes);
                    }
                  }
                }
              }

              if (
                statsParams.variantGroupId ||
                statsParams.asinIds ||
                statsParams.asinCodes
              ) {
                console.log('加载异常时长统计，参数:', statsParams);
                const statsResult = await getAbnormalDurationStatistics(
                  statsParams,
                );
                console.log('异常时长统计结果:', statsResult);

                // 检查返回的数据结构
                if (statsResult?.data) {
                  const chartData = statsResult.data;
                  // 检查是否有数据
                  if (
                    chartData.data &&
                    Array.isArray(chartData.data) &&
                    chartData.data.length > 0
                  ) {
                    setAbnormalDurationData(chartData);
                    setShowChart(true);
                    console.log('图表数据已设置，显示图表');
                  } else {
                    console.log('统计数据为空，隐藏图表');
                    setShowChart(false);
                    setAbnormalDurationData(null);
                  }
                } else {
                  console.log('统计结果为空，隐藏图表');
                  setShowChart(false);
                  setAbnormalDurationData(null);
                }
              } else {
                console.log('缺少必要的筛选参数，隐藏图表');
                setShowChart(false);
                setAbnormalDurationData(null);
              }
            } catch (error) {
              console.error('加载异常时长统计失败:', error);
              setShowChart(false);
              setAbnormalDurationData(null);
            }
          } else {
            console.log('不满足图表显示条件，隐藏图表');
            setShowChart(false);
            setAbnormalDurationData(null);
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
        toolBarRender={() => [
          <Button
            key="export"
            onClick={async () => {
              try {
                const params = new URLSearchParams();
                // 获取当前表格的筛选条件
                const formValues = actionRef.current?.getFieldsValue?.() || {};

                // 处理时间范围（transform 函数已经转换为 startTime 和 endTime）
                if (formValues.startTime) {
                  params.append('startTime', formValues.startTime);
                }
                if (formValues.endTime) {
                  params.append('endTime', formValues.endTime);
                }

                // 处理其他筛选条件
                if (formValues.country) {
                  params.append('country', formValues.country);
                }
                if (formValues.checkType) {
                  params.append('checkType', formValues.checkType);
                }
                if (
                  formValues.isBroken !== undefined &&
                  formValues.isBroken !== ''
                ) {
                  params.append('isBroken', formValues.isBroken);
                }
                if (formValues.asin) {
                  params.append('asin', formValues.asin);
                }

                // 如果URL中有参数，添加到请求中
                if (type === 'group' && id) {
                  params.append('variantGroupId', id);
                } else if (type === 'asin' && id) {
                  params.append('asinId', id);
                }

                const token = localStorage.getItem('token');
                const url = `/api/v1/export/monitor-history?${params.toString()}`;

                const response = await fetch(url, {
                  method: 'GET',
                  headers: {
                    Authorization: `Bearer ${token}`,
                  },
                });

                if (response.ok) {
                  const blob = await response.blob();
                  const downloadUrl = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = downloadUrl;
                  a.download = `监控历史_${
                    new Date().toISOString().split('T')[0]
                  }.xlsx`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  window.URL.revokeObjectURL(downloadUrl);
                  message.success('导出成功');
                } else {
                  message.error('导出失败');
                }
              } catch (error) {
                console.error('导出失败:', error);
                message.error('导出失败');
              }
            }}
          >
            导出Excel
          </Button>,
        ]}
      />

      {/* 异常时长统计图表 - 放在表格下方 */}
      {showChart && abnormalDurationData && (
        <Card
          title="异常时长统计"
          style={{ marginTop: 16 }}
          extra={
            <Tag>
              时间粒度:{' '}
              {abnormalDurationData.timeGranularity === 'hour'
                ? '按小时'
                : abnormalDurationData.timeGranularity === 'day'
                ? '按天'
                : '按周'}
            </Tag>
          }
        >
          <AbnormalDurationChart data={abnormalDurationData} />
        </Card>
      )}
    </PageContainer>
  );
};

export default MonitorHistoryPage;
