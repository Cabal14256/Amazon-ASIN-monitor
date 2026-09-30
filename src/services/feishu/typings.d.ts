declare namespace API {
  type FeishuEmergencyConfig = {
    enabled: boolean;
    timeMode: 'rolling' | 'daily' | 'combined';
    windowMinutes: number;
    startTime: string;
    endTime: string;
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
