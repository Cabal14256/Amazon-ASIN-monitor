declare namespace API {
  type FeishuEmergencyConfig = {
    enabled: boolean;
    timeMode: 'rolling' | 'daily' | 'combined';
    windowMinutes: number;
    startTime: string;
    endTime: string;
    /** 窗口内未尝试电话加急的新增异常变体组数，严格超过时触发。 */
    threshold: number;
    cooldownMinutes: number;
    userIds: string[];
  };

  type FeishuConfig = {
    id?: number;
    country?: string;
    webhookUrl?: string;
    enabled?: number;
    emergency?: FeishuEmergencyConfig;
    createTime?: string;
    updateTime?: string;
  };
}
