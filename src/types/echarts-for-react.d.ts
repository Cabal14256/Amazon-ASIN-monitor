declare module 'echarts-for-react' {
  import type { ComponentType, CSSProperties } from 'react';

  export interface ReactEChartsProps {
    option: Record<string, any>;
    style?: CSSProperties;
    theme?: string | Record<string, any>;
    notMerge?: boolean;
    lazyUpdate?: boolean;
    onEvents?: Record<string, (event: any) => void>;
    opts?: {
      renderer?: 'canvas' | 'svg';
      width?: number;
      height?: number;
    };
  }

  const ReactECharts: ComponentType<ReactEChartsProps>;
  export default ReactECharts;
}
