import { ExportOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  Col,
  Input,
  Row,
  Select,
  Space,
  Table,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React from 'react';
import {
  countryMap,
  createDurationSummaryRateColumns,
  exportToCSV,
  formatHours,
  formatHoursForExport,
  formatPercentForExport,
  getCountryName,
  periodTimeSlotColumns,
} from '../helpers';
import type {
  PeriodFilter,
  PeriodSummaryState,
  TimeSlotGranularity,
} from '../types';

type PeriodSummaryCardProps = {
  hourGranularityDisabled: boolean;
  loading: boolean;
  onFilterChange: (next: PeriodFilter) => void;
  onPageChange: (page: number, pageSize: number) => void;
  onQuery: () => void;
  onTimeSlotChange: (value: TimeSlotGranularity) => void;
  periodFilter: PeriodFilter;
  periodSummary: PeriodSummaryState;
  periodTimeSlot: TimeSlotGranularity;
};

const emptyState = (
  <div style={{ textAlign: 'center', padding: 40 }}>暂无数据</div>
);

const handleExportPeriodSummary = (data: API.PeriodSummary[]) => {
  if (data.length === 0) {
    message.warning('暂无数据可导出');
    return;
  }

  exportToCSV(
    [
      { key: 'timeRange', label: '时间槽' },
      { key: 'country', label: '国家' },
      { key: 'site', label: '站点' },
      { key: 'brand', label: '品牌' },
      { key: 'totalDurationHours', label: '总监控时长' },
      { key: 'ratioAllTime', label: '整体异常时长占比' },
      { key: 'globalPeakRate', label: '高峰异常时长占总时长' },
      { key: 'globalLowRate', label: '低峰异常时长占总时长' },
      { key: 'ratioHigh', label: '高峰时段内异常占比' },
      { key: 'ratioLow', label: '低峰时段内异常占比' },
    ],
    data.map((item) => ({
      timeRange: item.timeRange || '-',
      country: getCountryName(item.country),
      site: item.site || '-',
      brand: item.brand || '-',
      totalDurationHours: formatHoursForExport(item.totalDurationHours),
      ratioAllTime: formatPercentForExport(item.ratioAllTime),
      globalPeakRate: formatPercentForExport(item.globalPeakRate),
      globalLowRate: formatPercentForExport(item.globalLowRate),
      ratioHigh: formatPercentForExport(item.ratioHigh),
      ratioLow: formatPercentForExport(item.ratioLow),
    })),
    '周期时长汇总表',
  );
};

const periodSummaryColumns: ColumnsType<API.PeriodSummary> = [
  {
    title: '时间槽',
    dataIndex: 'timeRange',
    key: 'timeRange',
  },
  {
    title: '国家',
    dataIndex: 'country',
    key: 'country',
    render: (text: string | undefined) =>
      text ? countryMap[text] || text : '-',
  },
  {
    title: '站点',
    dataIndex: 'site',
    key: 'site',
    render: (text: string | undefined) => text || '-',
  },
  {
    title: '品牌',
    dataIndex: 'brand',
    key: 'brand',
    render: (text: string | undefined) => text || '-',
  },
  {
    title: '总监控时长',
    dataIndex: 'totalDurationHours',
    key: 'totalDurationHours',
    align: 'right',
    render: (value?: number) => formatHours(value),
  },
  ...createDurationSummaryRateColumns<API.PeriodSummary>(),
];

const PeriodSummaryCard: React.FC<PeriodSummaryCardProps> = ({
  hourGranularityDisabled,
  loading,
  onFilterChange,
  onPageChange,
  onQuery,
  onTimeSlotChange,
  periodFilter,
  periodSummary,
  periodTimeSlot,
}) => {
  const renderPeriodTimeSlotDetails = (record: API.PeriodSummary) => (
    <Table<API.PeriodSummaryTimeSlotDetail>
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
    <Row gutter={16} style={{ marginTop: 16 }}>
      <Col span={24}>
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
                  onFilterChange({ ...periodFilter, country: value })
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
                  onFilterChange({ ...periodFilter, site: e.target.value })
                }
              />
              <Input
                style={{ width: 150 }}
                placeholder="品牌"
                allowClear
                value={periodFilter.brand}
                onChange={(e) =>
                  onFilterChange({ ...periodFilter, brand: e.target.value })
                }
              />
              <span>时间槽粒度：</span>
              <Select
                style={{ width: 120 }}
                value={periodTimeSlot}
                onChange={onTimeSlotChange}
              >
                <Select.Option value="hour" disabled={hourGranularityDisabled}>
                  按小时
                </Select.Option>
                <Select.Option value="day">按天</Select.Option>
              </Select>
              <Button type="primary" onClick={onQuery} loading={loading}>
                查询
              </Button>
              <Button
                icon={<ExportOutlined />}
                onClick={() => handleExportPeriodSummary(periodSummary.list)}
                disabled={periodSummary.list.length === 0}
              >
                导出CSV
              </Button>
            </Space>
          }
        >
          {periodSummary.list.length > 0 ? (
            <Table<API.PeriodSummary>
              dataSource={periodSummary.list}
              pagination={{
                current: periodSummary.current,
                pageSize: periodSummary.pageSize,
                total: periodSummary.total,
                showSizeChanger: true,
                showTotal: (total) => `共 ${total} 条`,
                onChange: (page, size) => {
                  onPageChange(page, size || 10);
                },
              }}
              rowKey={(record, index) =>
                `${record.timeRange}_${record.country}_${record.site}_${record.brand}_${index}`
              }
              columns={periodSummaryColumns}
              expandable={{
                expandedRowRender: renderPeriodTimeSlotDetails,
                rowExpandable: (record) =>
                  Boolean(record.timeSlotDetails?.length),
              }}
              scroll={{ x: 1400 }}
            />
          ) : (
            emptyState
          )}
        </Card>
      </Col>
    </Row>
  );
};

export default PeriodSummaryCard;
