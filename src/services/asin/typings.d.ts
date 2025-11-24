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
}
