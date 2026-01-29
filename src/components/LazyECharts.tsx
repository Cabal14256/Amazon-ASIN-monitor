import React, { Suspense } from 'react';
import type { CSSProperties } from 'react';
import type { ReactEChartsProps } from 'echarts-for-react';

const ReactECharts = React.lazy(() => import('echarts-for-react'));

interface LazyEChartsProps extends ReactEChartsProps {
  loadingFallback?: React.ReactNode;
}

const getFallback = (props: LazyEChartsProps) => {
  if (props.loadingFallback) {
    return props.loadingFallback;
  }

  const style = props.style || {};
  const height =
    typeof style.height !== 'undefined' ? style.height : 240;
  const width = typeof style.width !== 'undefined' ? style.width : '100%';
  const fallbackStyle: CSSProperties = {
    height,
    width,
  };
  return <div style={fallbackStyle} />;
};

const LazyECharts: React.FC<LazyEChartsProps> = (props) => {
  const { loadingFallback, ...rest } = props;
  return (
    <Suspense fallback={getFallback(props)}>
      <ReactECharts {...rest} />
    </Suspense>
  );
};

export default LazyECharts;
