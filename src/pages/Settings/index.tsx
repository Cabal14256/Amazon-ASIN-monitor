import services from '@/services/settings';
import { useMessage } from '@/utils/message';
import {
  PageContainer,
  ProForm,
  ProFormDigit,
  ProFormSwitch,
  ProFormText,
} from '@ant-design/pro-components';
import { Alert, Card, Space, Tabs } from 'antd';
import React, { useEffect, useState } from 'react';

const { getSPAPIConfigs, updateSPAPIConfig } = services.SPAPIConfigController;
const { getFeishuConfigs, upsertFeishuConfig } = services.FeishuController;

const MONITOR_CONCURRENCY_LIMIT = 10;

const SettingsPage: React.FC<unknown> = () => {
  const message = useMessage();
  const [spApiConfigs, setSpApiConfigs] = useState<API.SPAPIConfig[]>([]);
  const [feishuConfigs, setFeishuConfigs] = useState<API.FeishuConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('sp-api');
  const [spApiForm] = ProForm.useForm();
  const [feishuUSForm] = ProForm.useForm();
  const [feishuEUForm] = ProForm.useForm();

  // 加载配置
  const loadConfigs = async () => {
    setLoading(true);
    try {
      const [spApiResponse, feishuResponse] = await Promise.all([
        getSPAPIConfigs(),
        getFeishuConfigs(),
      ]);

      let spApiData: API.SPAPIConfig[] = [];
      let feishuData: API.FeishuConfig[] = [];

      if (spApiResponse && typeof spApiResponse === 'object') {
        if ('data' in spApiResponse) {
          spApiData = (spApiResponse.data as API.SPAPIConfig[]) || [];
        } else if (Array.isArray(spApiResponse)) {
          spApiData = spApiResponse;
        }
      }

      if (feishuResponse && typeof feishuResponse === 'object') {
        if ('data' in feishuResponse) {
          feishuData = (feishuResponse.data as API.FeishuConfig[]) || [];
        } else if (Array.isArray(feishuResponse)) {
          feishuData = feishuResponse;
        }
      }

      setSpApiConfigs(spApiData);
      setFeishuConfigs(feishuData);

      // 设置SP-API表单值
      const spApiFormValues: any = {};
      spApiData.forEach((config: API.SPAPIConfig) => {
        if (!config.configKey) {
          return;
        }

        const value =
          config.configKey === 'MONITOR_MAX_CONCURRENT_GROUP_CHECKS'
            ? config.configValue
              ? Math.min(
                  Number(config.configValue),
                  MONITOR_CONCURRENCY_LIMIT,
                )
              : undefined
            : config.configValue || '';

        spApiFormValues[config.configKey] = value;
      });
      // 只在当前 tab 是 sp-api 时设置值
      if (activeTab === 'sp-api') {
        spApiForm.setFieldsValue(spApiFormValues);
      }

      // 设置飞书表单值
      const usConfig = feishuData.find(
        (c: API.FeishuConfig) => c.country === 'US',
      );
      const euConfig = feishuData.find(
        (c: API.FeishuConfig) => c.country === 'EU',
      );

      // 调试日志
      console.log('[Settings] 飞书配置数据:', {
        feishuData,
        usConfig,
        euConfig,
        activeTab,
      });

      // 只在当前 tab 是 feishu 时设置值
      if (activeTab === 'feishu') {
        // 使用 setTimeout 确保表单已经渲染
        setTimeout(() => {
          const usValues = {
            webhookUrl: usConfig?.webhookUrl || '',
            enabled: usConfig?.enabled === 1,
          };
          const euValues = {
            webhookUrl: euConfig?.webhookUrl || '',
            enabled: euConfig?.enabled === 1,
          };
          console.log('[Settings] 设置US表单值:', usValues);
          console.log('[Settings] 设置EU表单值:', euValues);
          feishuUSForm.setFieldsValue(usValues);
          feishuEUForm.setFieldsValue(euValues);
        }, 100);
      }
    } catch (error) {
      console.error('加载配置失败:', error);
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfigs();
  }, []);

  // 保存SP-API配置
  const buildConfigEntry = (
    key: string,
    value: any,
    description: string,
  ) => ({
    configKey: key,
    configValue:
      value !== undefined && value !== null ? String(value) : undefined,
    description,
  });

  const handleSaveSPAPIConfig = async (values: any) => {
    try {
      const configs = [
        buildConfigEntry(
          'MONITOR_MAX_CONCURRENT_GROUP_CHECKS',
          values.MONITOR_MAX_CONCURRENT_GROUP_CHECKS ?? 3,
          '每次最多同时检查的变体组数量',
        ),
        buildConfigEntry(
          'SP_API_US_LWA_CLIENT_ID',
          values.SP_API_US_LWA_CLIENT_ID,
          'US 区域 LWA Client ID',
        ),
        buildConfigEntry(
          'SP_API_US_LWA_CLIENT_SECRET',
          values.SP_API_US_LWA_CLIENT_SECRET,
          'US 区域 LWA Client Secret',
        ),
        buildConfigEntry(
          'SP_API_US_REFRESH_TOKEN',
          values.SP_API_US_REFRESH_TOKEN,
          'US 区域 Refresh Token',
        ),
        buildConfigEntry(
          'SP_API_EU_LWA_CLIENT_ID',
          values.SP_API_EU_LWA_CLIENT_ID,
          'EU 区域 LWA Client ID',
        ),
        buildConfigEntry(
          'SP_API_EU_LWA_CLIENT_SECRET',
          values.SP_API_EU_LWA_CLIENT_SECRET,
          'EU 区域 LWA Client Secret',
        ),
        buildConfigEntry(
          'SP_API_EU_REFRESH_TOKEN',
          values.SP_API_EU_REFRESH_TOKEN,
          'EU 区域 Refresh Token',
        ),
        buildConfigEntry(
          'SP_API_ACCESS_KEY_ID',
          values.SP_API_ACCESS_KEY_ID,
          'AWS Access Key ID（US+EU共用）',
        ),
        buildConfigEntry(
          'SP_API_SECRET_ACCESS_KEY',
          values.SP_API_SECRET_ACCESS_KEY,
          'AWS Secret Access Key（US+EU共用）',
        ),
        buildConfigEntry(
          'SP_API_ROLE_ARN',
          values.SP_API_ROLE_ARN,
          'AWS IAM Role ARN（US+EU共用）',
        ),
      ].map((entry) => ({
        ...entry,
        configValue: entry.configValue ?? '',
      }));

      await updateSPAPIConfig({ configs });
      message.success('SP-API配置已保存并重新加载');
      await loadConfigs();
    } catch (error: any) {
      message.error(error?.errorMessage || '保存失败');
    }
  };

  // 保存飞书配置
  const handleSaveFeishuConfig = async (region: 'US' | 'EU', values: any) => {
    try {
      await upsertFeishuConfig({
        country: region,
        webhookUrl: values.webhookUrl,
        enabled: values.enabled,
      });
      message.success(`${region}区域飞书配置已保存`);
      await loadConfigs();
    } catch (error: any) {
      message.error(error?.errorMessage || '保存失败');
    }
  };

  const tabItems = [
    {
      key: 'sp-api',
      label: 'SP-API配置',
      children: (
        <Card>
          <Alert
            message="SP-API配置说明"
            description="修改配置后会自动重新加载，无需重启服务。如果LWA Token失效，请及时更新Refresh Token。"
            type="info"
            showIcon
            style={{ marginBottom: 24 }}
          />
          <ProForm
            form={spApiForm}
            onFinish={handleSaveSPAPIConfig}
            submitter={{
              resetButtonProps: {
                onClick: () => {
                  loadConfigs(); // 自定义重置行为：重新加载配置
                },
              },
            }}
          >
            <ProForm.Group title="监控并发配置">
              <ProFormDigit
                name="MONITOR_MAX_CONCURRENT_GROUP_CHECKS"
                label="并发变体组数"
                min={1}
                max={MONITOR_CONCURRENCY_LIMIT}
                extra={`每次监控任务最多同时检查的变体组数量（建议 ≤ ${MONITOR_CONCURRENCY_LIMIT}）`}
                fieldProps={{
                  style: { width: '100%' },
                }}
                rules={[
                  {
                    required: true,
                    type: 'number',
                    message: '请输入大于0的值',
                  },
                  {
                    validator: (_, value) => {
                      if (!value) {
                        return Promise.resolve();
                      }
                      if (value > MONITOR_CONCURRENCY_LIMIT) {
                        return Promise.reject(
                          new Error(
                            `建议不超过 ${MONITOR_CONCURRENCY_LIMIT}，避免 SP-API 请求过载`,
                          ),
                        );
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
              />
            </ProForm.Group>

            <ProForm.Group title="US区域 LWA 配置">
              <ProFormText
                name="SP_API_US_LWA_CLIENT_ID"
                label="LWA Client ID"
                placeholder="请输入US区域的LWA Client ID"
                rules={[{ required: true, message: '请输入LWA Client ID' }]}
                fieldProps={{
                  style: { width: '100%' },
                }}
              />
              <ProFormText.Password
                name="SP_API_US_LWA_CLIENT_SECRET"
                label="LWA Client Secret"
                placeholder="请输入US区域的LWA Client Secret"
                rules={[{ required: true, message: '请输入LWA Client Secret' }]}
                fieldProps={{
                  style: { width: '100%' },
                }}
              />
              <ProFormText.Password
                name="SP_API_US_REFRESH_TOKEN"
                label="Refresh Token"
                placeholder="请输入US区域的Refresh Token"
                rules={[{ required: true, message: '请输入Refresh Token' }]}
                fieldProps={{
                  style: { width: '100%' },
                }}
              />
            </ProForm.Group>

            <ProForm.Group title="EU区域 LWA 配置">
              <ProFormText
                name="SP_API_EU_LWA_CLIENT_ID"
                label="LWA Client ID"
                placeholder="请输入EU区域的LWA Client ID"
                rules={[{ required: true, message: '请输入LWA Client ID' }]}
                fieldProps={{
                  style: { width: '100%' },
                }}
              />
              <ProFormText.Password
                name="SP_API_EU_LWA_CLIENT_SECRET"
                label="LWA Client Secret"
                placeholder="请输入EU区域的LWA Client Secret"
                rules={[{ required: true, message: '请输入LWA Client Secret' }]}
                fieldProps={{
                  style: { width: '100%' },
                }}
              />
              <ProFormText.Password
                name="SP_API_EU_REFRESH_TOKEN"
                label="Refresh Token"
                placeholder="请输入EU区域的Refresh Token"
                rules={[{ required: true, message: '请输入Refresh Token' }]}
                fieldProps={{
                  style: { width: '100%' },
                }}
              />
            </ProForm.Group>

            <ProForm.Group title="共享 AWS IAM 配置">
              <ProFormText
                name="SP_API_ACCESS_KEY_ID"
                label="AWS Access Key ID"
                placeholder="请输入 AWS Access Key ID"
                rules={[{ required: true, message: '请输入 AWS Access Key ID' }]}
                fieldProps={{
                  style: { width: '100%' },
                }}
              />
              <ProFormText.Password
                name="SP_API_SECRET_ACCESS_KEY"
                label="AWS Secret Access Key"
                placeholder="请输入 AWS Secret Access Key"
                rules={[
                  { required: true, message: '请输入 AWS Secret Access Key' },
                ]}
                fieldProps={{
                  style: { width: '100%' },
                }}
              />
              <ProFormText
                name="SP_API_ROLE_ARN"
                label="AWS IAM Role ARN"
                placeholder="请输入 AWS IAM Role ARN"
                rules={[{ required: true, message: '请输入 AWS IAM Role ARN' }]}
                fieldProps={{
                  style: { width: '100%' },
                }}
              />
            </ProForm.Group>
          </ProForm>
        </Card>
      ),
    },
    {
      key: 'feishu',
      label: '飞书配置',
      children: (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Card title="US区域配置">
            <ProForm
              form={feishuUSForm}
              onFinish={(values) => handleSaveFeishuConfig('US', values)}
              submitter={{
                resetButtonProps: {
                  onClick: () => {
                    loadConfigs();
                  },
                },
              }}
            >
              <ProFormText
                name="webhookUrl"
                label="Webhook URL"
                placeholder="请输入飞书Webhook URL"
                rules={[
                  { required: true, message: '请输入Webhook URL' },
                  { type: 'url', message: '请输入有效的URL' },
                ]}
                fieldProps={{
                  style: { width: '100%' },
                }}
              />
              <ProFormSwitch
                name="enabled"
                label="启用状态"
                checkedChildren="启用"
                unCheckedChildren="禁用"
              />
            </ProForm>
          </Card>

          <Card title="EU区域配置（包括UK、DE、FR、IT、ES）">
            <ProForm
              form={feishuEUForm}
              onFinish={(values) => handleSaveFeishuConfig('EU', values)}
              submitter={{
                resetButtonProps: {
                  onClick: () => {
                    loadConfigs();
                  },
                },
              }}
            >
              <ProFormText
                name="webhookUrl"
                label="Webhook URL"
                placeholder="请输入飞书Webhook URL"
                rules={[
                  { required: true, message: '请输入Webhook URL' },
                  { type: 'url', message: '请输入有效的URL' },
                ]}
                fieldProps={{
                  style: { width: '100%' },
                }}
              />
              <ProFormSwitch
                name="enabled"
                label="启用状态"
                checkedChildren="启用"
                unCheckedChildren="禁用"
              />
            </ProForm>
          </Card>
        </Space>
      ),
    },
  ];

  return (
    <PageContainer
      header={{
        title: '系统设置',
        breadcrumb: {},
      }}
      loading={loading}
    >
      <Tabs
        items={tabItems}
        activeKey={activeTab}
        onChange={(key) => {
          setActiveTab(key);
          // Tab 切换时设置表单值
          if (key === 'sp-api' && spApiConfigs.length > 0) {
            const spApiFormValues: any = {};
            spApiConfigs.forEach((config: API.SPAPIConfig) => {
              if (config.configKey) {
                spApiFormValues[config.configKey] = config.configValue || '';
              }
            });
            setTimeout(() => {
              spApiForm.setFieldsValue(spApiFormValues);
            }, 0);
          } else if (key === 'feishu' && feishuConfigs.length > 0) {
            const usConfig = feishuConfigs.find(
              (c: API.FeishuConfig) => c.country === 'US',
            );
            const euConfig = feishuConfigs.find(
              (c: API.FeishuConfig) => c.country === 'EU',
            );
            setTimeout(() => {
              feishuUSForm.setFieldsValue({
                webhookUrl: usConfig?.webhookUrl || '',
                enabled: usConfig?.enabled === 1,
              });
              feishuEUForm.setFieldsValue({
                webhookUrl: euConfig?.webhookUrl || '',
                enabled: euConfig?.enabled === 1,
              });
            }, 0);
          }
        }}
      />
    </PageContainer>
  );
};

export default SettingsPage;
