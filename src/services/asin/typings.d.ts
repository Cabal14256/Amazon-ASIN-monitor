/* eslint-disable */
// ASIN 监控系统类型定义

declare namespace API {
  /** 变体状态枚举 */
  type VariantStatus = 'NORMAL' | 'BROKEN';

  /** 国家/区域枚举 */
  type Country = 'US' | 'UK' | 'DE' | 'FR' | 'IT' | 'ES';

  /** ASIN类型枚举 */
  type ASINType = 'MAIN_LINK' | 'SUB_REVIEW';

  /** ASIN 信息 */
  interface ASINInfo {
    /** ASIN ID */
    id?: string;
    /** ASIN 编码 */
    asin?: string;
    /** ASIN 名称 */
    name?: string;
    /** ASIN类型：MAIN_LINK-主链, SUB_REVIEW-副评 */
    asinType?: ASINType;
    /** 所属国家 */
    country?: Country;
    /** 站点 */
    site?: string;
    /** 品牌 */
    brand?: string;
    /** 变体状态：0-正常，1-异常 */
    isBroken?: number;
    /** 变体状态文本 */
    variantStatus?: VariantStatus;
    /** 父级变体组ID */
    parentId?: string;
    /** 创建时间 */
    createTime?: string;
    /** 更新时间 */
    updateTime?: string;
    /** 监控更新时间（上一次检查的时间） */
    lastCheckTime?: string;
    /** 飞书通知开关：0-关闭，1-开启 */
    feishuNotifyEnabled?: number;
  }

  /** 变体组信息 */
  interface VariantGroup {
    /** 变体组ID */
    id?: string;
    /** 变体组名称 */
    name?: string;
    /** 所属国家 */
    country?: Country;
    /** 站点 */
    site?: string;
    /** 品牌 */
    brand?: string;
    /** 变体状态：0-正常，1-异常 */
    isBroken?: number;
    /** 变体状态文本 */
    variantStatus?: VariantStatus;
    /** 父级ID（用于区分变体组和ASIN，变体组此字段为undefined） */
    parentId?: string;
    /** 子级ASIN列表 */
    children?: ASINInfo[];
    /** 创建时间 */
    createTime?: string;
    /** 更新时间 */
    updateTime?: string;
  }

  /** 分页信息 */
  interface PageInfo_VariantGroup_ {
    current?: number;
    pageSize?: number;
    total?: number;
    list?: VariantGroup[];
  }

  /** 结果包装 */
  interface Result_PageInfo_VariantGroup__ {
    success?: boolean;
    errorMessage?: string;
    data?: PageInfo_VariantGroup_;
  }

  interface Result_VariantGroup_ {
    success?: boolean;
    errorMessage?: string;
    data?: VariantGroup;
  }

  interface Result_ASINInfo_ {
    success?: boolean;
    errorMessage?: string;
    data?: ASINInfo;
  }

  /** 变体组创建/更新VO */
  interface VariantGroupVO {
    name?: string;
    country?: Country;
    site?: string;
    brand?: string;
  }

  /** ASIN创建/更新VO */
  interface ASINInfoVO {
    asin?: string;
    name?: string;
    asinType?: ASINType;
    country?: Country;
    site?: string;
    brand?: string;
    parentId?: string;
  }

  /** 监控历史记录 */
  interface MonitorHistory {
    /** 历史记录ID */
    id?: number;
    /** 变体组ID */
    variantGroupId?: string;
    /** ASIN ID */
    asinId?: string;
    /** 检查类型 */
    checkType?: 'GROUP' | 'ASIN';
    /** 国家 */
    country?: Country;
    /** 是否异常 */
    isBroken?: number;
    /** 检查时间 */
    checkTime?: string;
    /** 检查结果详情 */
    checkResult?: string;
    /** 是否已发送通知 */
    notificationSent?: number;
    /** 创建时间 */
    createTime?: string;
    /** 变体组名称（关联查询） */
    variantGroupName?: string;
    /** ASIN编码（关联查询） */
    asin?: string;
    /** ASIN名称（关联查询） */
    asinName?: string;
  }

  /** 监控历史分页信息 */
  interface PageInfo_MonitorHistory_ {
    current?: number;
    pageSize?: number;
    total?: number;
    list?: MonitorHistory[];
  }

  /** 监控历史结果包装 */
  interface Result_PageInfo_MonitorHistory__ {
    success?: boolean;
    errorMessage?: string;
    data?: PageInfo_MonitorHistory_;
  }

  interface Result_MonitorHistory_ {
    success?: boolean;
    errorMessage?: string;
    data?: MonitorHistory;
  }

  /** 监控统计信息 */
  interface MonitorStatistics {
    /** 总检查次数 */
    totalChecks?: number;
    /** 异常次数 */
    brokenCount?: number;
    /** 正常次数 */
    normalCount?: number;
    /** 变体组数量 */
    groupCount?: number;
    /** ASIN数量 */
    asinCount?: number;
  }

  interface Result_MonitorStatistics_ {
    success?: boolean;
    errorMessage?: string;
    data?: MonitorStatistics;
  }

  /** 按时间统计信息 */
  interface TimeStatistics {
    /** 时间周期 */
    time_period?: string;
    /** 总检查次数 */
    total_checks?: number;
    /** 异常次数 */
    broken_count?: number;
    /** 正常次数 */
    normal_count?: number;
  }

  interface Result_TimeStatistics_ {
    success?: boolean;
    errorMessage?: string;
    data?: TimeStatistics[];
  }

  /** 按国家统计信息 */
  interface CountryStatistics {
    /** 国家代码 */
    country?: string;
    /** 总检查次数 */
    total_checks?: number;
    /** 异常次数 */
    broken_count?: number;
    /** 正常次数 */
    normal_count?: number;
  }

  interface Result_CountryStatistics_ {
    success?: boolean;
    errorMessage?: string;
    data?: CountryStatistics[];
  }

  /** 按变体组统计信息 */
  interface VariantGroupStatistics {
    /** 变体组ID */
    variant_group_id?: string;
    /** 变体组名称 */
    variant_group_name?: string;
    /** 总检查次数 */
    total_checks?: number;
    /** 异常次数 */
    broken_count?: number;
    /** 正常次数 */
    normal_count?: number;
  }

  interface Result_VariantGroupStatistics_ {
    success?: boolean;
    errorMessage?: string;
    data?: VariantGroupStatistics[];
  }

  /** 高峰期统计信息 */
  interface PeakHoursStatistics {
    /** 高峰期异常数量 */
    peakBroken?: number;
    /** 高峰期总数量 */
    peakTotal?: number;
    /** 高峰期异常率（百分比） */
    peakRate?: number;
    /** 低峰期异常数量 */
    offPeakBroken?: number;
    /** 低峰期总数量 */
    offPeakTotal?: number;
    /** 低峰期异常率（百分比） */
    offPeakRate?: number;
  }

  interface Result_PeakHoursStatistics_ {
    success?: boolean;
    errorMessage?: string;
    data?: PeakHoursStatistics;
  }

  /** Excel导入结果 */
  interface ImportResult {
    /** 总数 */
    total?: number;
    /** 成功数量 */
    successCount?: number;
    /** 失败数量 */
    failedCount?: number;
    /** 错误列表 */
    errors?: Array<{ row: number; message: string }>;
  }

  interface Result_ImportResult_ {
    success?: boolean;
    errorMessage?: string;
    data?: ImportResult;
  }

  /** 仪表盘概览数据 */
  interface DashboardOverview {
    /** 总变体组数 */
    totalGroups?: number;
    /** 总ASIN数 */
    totalASINs?: number;
    /** 异常变体组数 */
    brokenGroups?: number;
    /** 异常ASIN数 */
    brokenASINs?: number;
    /** 正常变体组数 */
    normalGroups?: number;
    /** 正常ASIN数 */
    normalASINs?: number;
    /** 今日检查次数 */
    todayChecks?: number;
    /** 今日异常次数 */
    todayBroken?: number;
  }

  /** 异常变体组信息（简化版） */
  interface BrokenVariantGroup {
    id?: string;
    name?: string;
    country?: string;
    site?: string;
    brand?: string;
    variant_status?: string;
    update_time?: string;
  }

  /** 异常ASIN信息（简化版） */
  interface BrokenASIN {
    id?: string;
    asin?: string;
    name?: string;
    country?: string;
    site?: string;
    brand?: string;
    variant_status?: string;
    update_time?: string;
    variant_group_name?: string;
  }

  /** 国家分布数据 */
  interface CountryDistribution {
    country?: string;
    total?: number;
    broken?: number;
    normal?: number;
  }

  /** 仪表盘数据 */
  interface DashboardData {
    /** 关键指标概览 */
    overview?: DashboardOverview;
    /** 实时异常监控 */
    realtimeAlerts?: {
      brokenGroups?: BrokenVariantGroup[];
      brokenASINs?: BrokenASIN[];
    };
    /** 状态分布 */
    distribution?: {
      byCountry?: CountryDistribution[];
    };
    /** 最近活动 */
    recentActivities?: MonitorHistory[];
  }

  interface Result_DashboardData_ {
    success?: boolean;
    errorMessage?: string;
    data?: DashboardData;
  }
}
