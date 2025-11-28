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
