import { Card, Col, Row, Select, Space, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React from 'react';
import { createDurationSummaryRateColumns, formatHours } from '../helpers';
import type { TimeSlotGranularity } from '../types';

type AllCountriesSummaryCardProps = {
  allCountriesSummary: API.AllCountriesSummary | null;
  allCountriesTimeSlot: TimeSlotGranularity;
  hourGranularityDisabled: boolean;
  loading: boolean;
  onTimeSlotChange: (value: TimeSlotGranularity) => void;
};

const emptyState = (
  <div style={{ textAlign: 'center', padding: 40 }}>暂无数据</div>
);

const allCountriesColumns: ColumnsType<API.AllCountriesSummary> = [
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
  ...createDurationSummaryRateColumns<API.AllCountriesSummary>(),
];

const AllCountriesSummaryCard: React.FC<AllCountriesSummaryCardProps> = ({
  allCountriesSummary,
  allCountriesTimeSlot,
  hourGranularityDisabled,
  loading,
  onTimeSlotChange,
}) => (
  <Row gutter={16} style={{ marginTop: 16 }}>
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
        {allCountriesSummary ? (
          <Table<API.AllCountriesSummary>
            dataSource={[allCountriesSummary]}
            pagination={false}
            columns={allCountriesColumns}
          />
        ) : (
          emptyState
        )}
      </Card>
    </Col>
  </Row>
);

export default AllCountriesSummaryCard;
