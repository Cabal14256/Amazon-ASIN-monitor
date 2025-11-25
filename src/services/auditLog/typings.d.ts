declare namespace API {
  /** 审计日志 */
  interface AuditLog {
    id?: number;
    userId?: string;
    username?: string;
    action?: string;
    resource?: string;
    resourceId?: string;
    resourceName?: string;
    method?: string;
    path?: string;
    ipAddress?: string;
    userAgent?: string;
    requestData?: any;
    responseStatus?: number;
    errorMessage?: string;
    createTime?: string;
  }

  /** 审计日志列表查询参数 */
  interface AuditLogListParams {
    userId?: string;
    username?: string;
    action?: string;
    resource?: string;
    resourceId?: string;
    startTime?: string;
    endTime?: string;
    current?: number;
    pageSize?: number;
  }

  /** 操作类型统计 */
  interface ActionStatistics {
    action?: string;
    count?: number;
  }

  /** 资源类型统计 */
  interface ResourceStatistics {
    resource?: string;
    count?: number;
  }
}
