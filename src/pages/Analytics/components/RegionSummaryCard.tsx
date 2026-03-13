import { Card, Col, Row, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React from 'react';
import { createDurationSummaryRateColumns, formatHours } from '../helpers';
import type { TimeSlotGranularity } from '../types';

type RegionSummaryCardProps = {
  loading: boolean;
  onTimeSlotChange: (value: TimeSlotGranularity) => void;
  regionSummary: API.RegionSummary[];
  regionTimeSlot: TimeSlotGranularity;
};

const emptyState = (
  <div style={{ textAlign: 'center', padding: 40 }}>暂无数据</div>
);

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
            <span>时间槽粒度：</span>
            <Select
              style={{ width: 120 }}
              value={regionTimeSlot}
              onChange={onTimeSlotChange}
            >
              <Select.Option value="hour">按小时</Select.Option>
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
