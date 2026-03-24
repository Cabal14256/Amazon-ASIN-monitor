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
    /** 变体组名称（模糊匹配） */
    variantGroupName?: string;
    /** ASIN名称（模糊匹配） */
    asinName?: string;
    /** ASIN类型（1/2 或 MAIN_LINK/SUB_REVIEW） */
    asinType?: string;
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
    /** 国家筛选 */
    country?: string;
    /** 开始时间 */
    startTime?: string;
    /** 结束时间 */
    endTime?: string;
    /** 是否返回时间序列明细（0-仅汇总，1-汇总+序列） */
    includeSeries?: '0' | '1';
    /** ASIN类型 */
    asinType?: string;
    /** ASIN名称（模糊匹配） */
    asinName?: string;
    /** 变体组名称（模糊匹配） */
    variantGroupName?: string;
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
