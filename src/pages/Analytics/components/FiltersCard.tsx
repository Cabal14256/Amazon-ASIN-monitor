import { Button, Card, DatePicker, Progress, Select, Space } from 'antd';
import type { Dayjs } from 'dayjs';
import React from 'react';

const { RangePicker } = DatePicker;

type FiltersCardProps = {
  country: string;
  countryMap: Record<string, string>;
  dateRange: [Dayjs, Dayjs];
  groupBy: string;
  hourGranularityDisabled: boolean;
  loading: boolean;
  progress: number;
  progressText: string;
  onCountryChange: (value: string) => void;
  onDateRangeChange: (dates: [Dayjs, Dayjs]) => void;
  onGroupByChange: (value: string) => void;
  onQuery: () => void;
};

const FiltersCard: React.FC<FiltersCardProps> = ({
  country,
  countryMap,
  dateRange,
  groupBy,
  hourGranularityDisabled,
  loading,
  progress,
  progressText,
  onCountryChange,
  onDateRangeChange,
  onGroupByChange,
  onQuery,
}) => (
  <Card style={{ marginBottom: 16 }}>
    <Space direction="vertical" style={{ width: '100%' }} size="small">
      <Space wrap>
        <span>时间范围：</span>
        <RangePicker
          value={dateRange}
          onChange={(dates) => {
            if (dates) {
              onDateRangeChange([dates[0]!, dates[1]!]);
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
          onChange={onCountryChange}
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
          onChange={onGroupByChange}
        >
          <Select.Option value="hour" disabled={hourGranularityDisabled}>
            按小时
          </Select.Option>
          <Select.Option value="day">按天</Select.Option>
          <Select.Option value="week">按周</Select.Option>
          <Select.Option value="month">按月</Select.Option>
        </Select>
        <Button type="primary" onClick={onQuery} loading={loading}>
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
);

export default FiltersCard;
