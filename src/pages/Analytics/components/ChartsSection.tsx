import LazyECharts from '@/components/LazyECharts';
import { Card, Col, Radio, Row } from 'antd';
import React from 'react';
import type {
  ChartOption,
  CountryColumnDatum,
  CountryPieDatum,
  LegendSelectChangedParams,
  TimeChartDatum,
  ValueMode,
  VariantGroupChartDatum,
  VariantGroupClickEvent,
} from '../types';

type ChartsSectionProps = {
  countryBarOptions: ChartOption;
  countryBarValueMode: ValueMode;
  countryColumnDisplayData: CountryColumnDatum[];
  countryPieData: CountryPieDatum[];
  countryPieOptions: ChartOption;
  countryPieValueMode: ValueMode;
  handleLegendSelectChanged: (params: LegendSelectChangedParams) => void;
  lineChartOptions: ChartOption;
  loading: boolean;
  onCountryBarValueModeChange: (value: ValueMode) => void;
  onCountryPieValueModeChange: (value: ValueMode) => void;
  onVariantGroupClick: (variantGroupId: string) => void;
  onVariantGroupValueModeChange: (value: ValueMode) => void;
  timeChartData: TimeChartDatum[];
  variantGroupDisplayData: VariantGroupChartDatum[];
  variantGroupOptions: ChartOption;
  variantGroupValueMode: ValueMode;
};

const emptyState = (
  <div style={{ textAlign: 'center', padding: 40 }}>暂无数据</div>
);

const ChartsSection: React.FC<ChartsSectionProps> = ({
  countryBarOptions,
  countryBarValueMode,
  countryColumnDisplayData,
  countryPieData,
  countryPieOptions,
  countryPieValueMode,
  handleLegendSelectChanged,
  lineChartOptions,
  loading,
  onCountryBarValueModeChange,
  onCountryPieValueModeChange,
  onVariantGroupClick,
  onVariantGroupValueModeChange,
  timeChartData,
  variantGroupDisplayData,
  variantGroupOptions,
  variantGroupValueMode,
}) => (
  <Row gutter={16} style={{ marginTop: 16 }}>
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
          emptyState
        )}
      </Card>
    </Col>

    <Col span={12} style={{ marginTop: 16 }}>
      <Card
        title="国家维度时长统计（柱状图）"
        loading={loading}
        extra={
          <Radio.Group
            value={countryBarValueMode}
            onChange={(e) => onCountryBarValueModeChange(e.target.value)}
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
          emptyState
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
            onChange={(e) => onCountryPieValueModeChange(e.target.value)}
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
          emptyState
        )}
      </Card>
    </Col>

    <Col span={24} style={{ marginTop: 16 }}>
      <Card
        title="变体组异常时长统计（Top 10）"
        loading={loading}
        extra={
          <Radio.Group
            value={variantGroupValueMode}
            onChange={(e) => onVariantGroupValueModeChange(e.target.value)}
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
              click: (params: VariantGroupClickEvent) => {
                const variantGroupId = params.data?.variantGroupId;
                if (variantGroupId) {
                  onVariantGroupClick(variantGroupId);
                }
              },
            }}
          />
        ) : (
          emptyState
        )}
      </Card>
    </Col>
  </Row>
);

export default ChartsSection;
