/* eslint-disable */
// 监控历史服务接口
import { request } from '@umijs/max';

/** 查询监控历史列表 */
export async function queryMonitorHistory(
  params: {
    // query
    /** 变体组ID */
    variantGroupId?: string;
    /** ASIN ID */
    asinId?: string;
    /** ASIN编码（字符串） */
    asin?: string;
    /** 国家筛选 */
    country?: string;
    /** 检查类型 */
    checkType?: string;
    /** 是否异常 */
    isBroken?: string;
    /** 开始时间 */
    startTime?: string;
    /** 结束时间 */
    endTime?: string;
    /** 当前页 */
    current?: number;
    /** 每页数量 */
    pageSize?: number;
  },
  options?: { [key: string]: any },
) {
  return request<API.Result_PageInfo_MonitorHistory__>(
    '/api/v1/monitor-history',
    {
      method: 'GET',
      params: {
        ...params,
      },
      ...(options || {}),
    },
  );
}

/** 获取监控历史详情 */
export async function getMonitorHistoryDetail(
  params: {
    // path
    /** 历史记录ID */
    id?: string;
  },
  options?: { [key: string]: any },
) {
  const { id: param0 } = params;
  return request<API.Result_MonitorHistory_>(
    `/api/v1/monitor-history/${param0}`,
    {
      method: 'GET',
      params: { ...params },
      ...(options || {}),
    },
  );
}

/** 获取统计信息 */
export async function getMonitorStatistics(
  params: {
    // query
    /** 变体组ID */
    variantGroupId?: string;
    /** ASIN ID */
    asinId?: string;
    /** 国家筛选 */
    country?: string;
    /** 开始时间 */
    startTime?: string;
    /** 结束时间 */
    endTime?: string;
  },
  options?: { [key: string]: any },
) {
  return request<API.Result_MonitorStatistics_>(
    '/api/v1/monitor-history/statistics',
    {
      method: 'GET',
      params: {
        ...params,
      },
      ...(options || {}),
    },
  );
}

/** 按时间分组统计 */
export async function getStatisticsByTime(
  params: {
    // query
    /** 国家筛选 */
    country?: string;
    /** 开始时间 */
    startTime?: string;
    /** 结束时间 */
    endTime?: string;
    /** 分组方式：day/hour/week/month */
    groupBy?: string;
  },
  options?: { [key: string]: any },
) {
  return request<API.Result_TimeStatistics_>(
    '/api/v1/monitor-history/statistics/by-time',
    {
      method: 'GET',
      params: {
        ...params,
      },
      ...(options || {}),
    },
  );
}

/** 按国家分组统计 */
export async function getStatisticsByCountry(
  params: {
    // query
    /** 开始时间 */
    startTime?: string;
    /** 结束时间 */
    endTime?: string;
  },
  options?: { [key: string]: any },
) {
  return request<API.Result_CountryStatistics_>(
    '/api/v1/monitor-history/statistics/by-country',
    {
      method: 'GET',
      params: {
        ...params,
      },
      ...(options || {}),
    },
  );
}

/** 按变体组分组统计 */
export async function getStatisticsByVariantGroup(
  params: {
    // query
    /** 国家筛选 */
    country?: string;
    /** 开始时间 */
    startTime?: string;
    /** 结束时间 */
    endTime?: string;
    /** 限制数量 */
    limit?: number;
  },
  options?: { [key: string]: any },
) {
  return request<API.Result_VariantGroupStatistics_>(
    '/api/v1/monitor-history/statistics/by-variant-group',
    {
      method: 'GET',
      params: {
        ...params,
      },
      ...(options || {}),
    },
  );
}

/** 高峰期统计 */
export async function getPeakHoursStatistics(
  params: {
    // query
    /** 国家筛选（必填） */
    country: string;
    /** 开始时间 */
    startTime?: string;
    /** 结束时间 */
    endTime?: string;
  },
  options?: { [key: string]: any },
) {
  return request<API.Result_PeakHoursStatistics_>(
    '/api/v1/monitor-history/statistics/peak-hours',
    {
      method: 'GET',
      params: {
        ...params,
      },
      ...(options || {}),
    },
  );
}

/** 全部国家汇总统计 */
export async function getAllCountriesSummary(
  params: {
    // query
    /** 开始时间 */
    startTime?: string;
    /** 结束时间 */
    endTime?: string;
    /** 时间槽粒度：hour/day */
    timeSlotGranularity?: string;
  },
  options?: { [key: string]: any },
) {
  return request<API.Result_AllCountriesSummary_>(
    '/api/v1/monitor-history/statistics/all-countries-summary',
    {
      method: 'GET',
      params: {
        ...params,
      },
      ...(options || {}),
    },
  );
}

/** 区域汇总统计（美国/欧洲） */
export async function getRegionSummary(
  params: {
    // query
    /** 开始时间 */
    startTime?: string;
    /** 结束时间 */
    endTime?: string;
    /** 时间槽粒度：hour/day */
    timeSlotGranularity?: string;
  },
  options?: { [key: string]: any },
) {
  return request<API.Result_RegionSummary_>(
    '/api/v1/monitor-history/statistics/region-summary',
    {
      method: 'GET',
      params: {
        ...params,
      },
      ...(options || {}),
    },
  );
}

/** 周期汇总统计 */
export async function getPeriodSummary(
  params: {
    // query
    /** 国家筛选 */
    country?: string;
    /** 站点筛选 */
    site?: string;
    /** 品牌筛选 */
    brand?: string;
    /** 开始时间 */
    startTime?: string;
    /** 结束时间 */
    endTime?: string;
    /** 时间槽粒度：hour/day */
    timeSlotGranularity?: string;
    /** 当前页 */
    current?: number;
    /** 每页数量 */
    pageSize?: number;
  },
  options?: { [key: string]: any },
) {
  return request<API.Result_PeriodSummary_>(
    '/api/v1/monitor-history/statistics/period-summary',
    {
      method: 'GET',
      params: {
        ...params,
      },
      ...(options || {}),
    },
  );
}

/** 按国家统计ASIN当前状态 */
export async function getASINStatisticsByCountry(options?: {
  [key: string]: any;
}) {
  return request<API.Result_CountryStatistics_>(
    '/api/v1/monitor-history/statistics/asin-by-country',
    {
      method: 'GET',
      ...(options || {}),
    },
  );
}

/** 按变体组统计ASIN当前状态 */
export async function getASINStatisticsByVariantGroup(
  params: {
    // query
    /** 限制数量 */
    limit?: number;
  },
  options?: { [key: string]: any },
) {
  return request<API.Result_VariantGroupStatistics_>(
    '/api/v1/monitor-history/statistics/asin-by-variant-group',
    {
      method: 'GET',
      params: {
        ...params,
      },
      ...(options || {}),
    },
  );
}

/** 获取异常时长统计 */
export async function getAbnormalDurationStatistics(
  params: {
    // query
    /** ASIN ID列表（逗号分隔或数组） */
    asinIds?: string | string[];
    /** ASIN编码列表（逗号分隔或数组） */
    asinCodes?: string | string[];
    /** 变体组ID */
    variantGroupId?: string;
    /** 开始时间 */
    startTime?: string;
    /** 结束时间 */
    endTime?: string;
  },
  options?: { [key: string]: any },
) {
  return request<API.Result_AbnormalDurationStatistics_>(
    '/api/v1/monitor-history/abnormal-duration-statistics',
    {
      method: 'GET',
      params: {
        ...params,
        // 如果asinIds是数组，转换为逗号分隔的字符串
        asinIds: Array.isArray(params.asinIds)
          ? params.asinIds.join(',')
          : params.asinIds,
        // 如果asinCodes是数组，转换为逗号分隔的字符串
        asinCodes: Array.isArray(params.asinCodes)
          ? params.asinCodes.join(',')
          : params.asinCodes,
      },
      ...(options || {}),
    },
  );
}
