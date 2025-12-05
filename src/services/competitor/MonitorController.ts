/* eslint-disable */
// 竞品监控历史服务接口
import { request } from '@umijs/max';

/** 查询监控历史列表 */
export async function queryCompetitorMonitorHistory(
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
    '/api/v1/competitor/monitor-history',
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
export async function getCompetitorMonitorHistoryById(
  params: {
    // path
    /** 历史记录ID */
    id?: string;
  },
  options?: { [key: string]: any },
) {
  const { id: param0 } = params;
  return request<API.Result_MonitorHistory_>(
    `/api/v1/competitor/monitor-history/${param0}`,
    {
      method: 'GET',
      params: { ...params },
      ...(options || {}),
    },
  );
}

/** 手动触发竞品监控检查 */
export async function triggerCompetitorManualCheck(
  body?: {
    /** 要检查的国家数组（可选，不提供则检查所有国家） */
    countries?: string[];
  },
  options?: { [key: string]: any },
) {
  return request<API.Result_any_>('/api/v1/competitor/monitor/trigger', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    data: body,
    ...(options || {}),
  });
}
