import { ExportOutlined } from '@ant-design/icons';
import {
  Button,
  Card,
  Col,
  Row,
  Select,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React from 'react';
import {
  createDurationSummaryRateColumns,
  exportToCSV,
  formatHours,
  formatHoursForExport,
  formatPercentForExport,
} from '../helpers';
import type { TimeSlotGranularity } from '../types';

type RegionSummaryCardProps = {
  hourGranularityDisabled: boolean;
  loading: boolean;
  onTimeSlotChange: (value: TimeSlotGranularity) => void;
  regionSummary: API.RegionSummary[];
  regionTimeSlot: TimeSlotGranularity;
};

const emptyState = (
  <div style={{ textAlign: 'center', padding: 40 }}>暂无数据</div>
);

const handleExportRegionSummary = (data: API.RegionSummary[]) => {
  if (data.length === 0) {
    message.warning('暂无数据可导出');
    return;
  }

  exportToCSV(
    [
      { key: 'region', label: '区域' },
      { key: 'timeRange', label: '时间段' },
      { key: 'totalDurationHours', label: '总监控时长' },
      { key: 'ratioAllTime', label: '整体异常时长占比' },
      { key: 'globalPeakRate', label: '高峰异常时长占总时长' },
      { key: 'globalLowRate', label: '低峰异常时长占总时长' },
      { key: 'ratioHigh', label: '高峰时段内异常占比' },
      { key: 'ratioLow', label: '低峰时段内异常占比' },
    ],
    data.map((item) => ({
      region: item.region || '-',
      timeRange: item.timeRange || '-',
      totalDurationHours: formatHoursForExport(item.totalDurationHours),
      ratioAllTime: formatPercentForExport(item.ratioAllTime),
      globalPeakRate: formatPercentForExport(item.globalPeakRate),
      globalLowRate: formatPercentForExport(item.globalLowRate),
      ratioHigh: formatPercentForExport(item.ratioHigh),
      ratioLow: formatPercentForExport(item.ratioLow),
    })),
    '美国欧洲时长汇总表',
  );
};

const regionSummaryColumns: ColumnsType<API.RegionSummary> = [
  {
    title: '区域',
    dataIndex: 'region',
    key: 'region',
    render: (text: string | undefined, record: API.RegionSummary) => (
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
    render: (value?: number) => formatHours(value),
  },
  ...createDurationSummaryRateColumns<API.RegionSummary>(),
];

const RegionSummaryCard: React.FC<RegionSummaryCardProps> = ({
  hourGranularityDisabled,
  loading,
  onTimeSlotChange,
  regionSummary,
  regionTimeSlot,
}) => (
  <Row gutter={16} style={{ marginTop: 16 }}>
    <Col span={24}>
      <Card
        title="美国/欧洲时长汇总表（含英德法西意）"
        loading={loading}
        extra={
          <Space>
            <Button
              icon={<ExportOutlined />}
              onClick={() => handleExportRegionSummary(regionSummary)}
              disabled={regionSummary.length === 0}
            >
              导出CSV
            </Button>
            <span>时间槽粒度：</span>
            <Select
              style={{ width: 120 }}
              value={regionTimeSlot}
              onChange={onTimeSlotChange}
            >
              <Select.Option value="hour" disabled={hourGranularityDisabled}>
                按小时
              </Select.Option>
              <Select.Option value="day">按天</Select.Option>
            </Select>
          </Space>
        }
      >
        {regionSummary.length > 0 ? (
          <Table<API.RegionSummary>
            dataSource={regionSummary}
            pagination={false}
            rowKey="regionCode"
            columns={regionSummaryColumns}
          />
        ) : (
          emptyState
        )}
      </Card>
    </Col>
  </Row>
);

export default RegionSummaryCard;
