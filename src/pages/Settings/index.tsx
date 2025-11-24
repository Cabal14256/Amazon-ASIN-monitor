import services from '@/services/settings';
import {
  PageContainer,
  ProForm,
  ProFormSwitch,
  ProFormText,
} from '@ant-design/pro-components';
import { Alert, Card, Space, Tabs } from 'antd';
import React, { useEffect, useState } from 'react';
import { useMessage } from '@/utils/message';

const { getSPAPIConfigs, updateSPAPIConfig } = services.SPAPIConfigController;
const { getFeishuConfigs, upsertFeishuConfig } = services.FeishuController;

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
        if (config.configKey) {
          spApiFormValues[config.configKey] = config.configValue || '';
        }
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
      // 只在当前 tab 是 feishu 时设置值
      if (activeTab === 'feishu') {
        feishuUSForm.setFieldsValue({
          webhookUrl: usConfig?.webhookUrl || '',
          enabled: usConfig?.enabled === 1,
        });
        feishuEUForm.setFieldsValue({
          webhookUrl: euConfig?.webhookUrl || '',
          enabled: euConfig?.enabled === 1,
        });
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
  const handleSaveSPAPIConfig = async (values: any) => {
    try {
      const configs = [
        {
          configKey: 'SP_API_LWA_CLIENT_ID',
          configValue: values.SP_API_LWA_CLIENT_ID || '',
          description: 'LWA Client ID',
        },
        {
          configKey: 'SP_API_LWA_CLIENT_SECRET',
          configValue: values.SP_API_LWA_CLIENT_SECRET || '',
          description: 'LWA Client Secret',
        },
        {
          configKey: 'SP_API_REFRESH_TOKEN',
          configValue: values.SP_API_REFRESH_TOKEN || '',
          description: 'LWA Refresh Token',
        },
        {
          configKey: 'SP_API_ACCESS_KEY_ID',
          configValue: values.SP_API_ACCESS_KEY_ID || '',
          description: 'AWS Access Key ID',
        },
        {
          configKey: 'SP_API_SECRET_ACCESS_KEY',
          configValue: values.SP_API_SECRET_ACCESS_KEY || '',
          description: 'AWS Secret Access Key',
        },
        {
          configKey: 'SP_API_ROLE_ARN',
          configValue: values.SP_API_ROLE_ARN || '',
          description: 'AWS IAM Role ARN',
        },
      ];

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
            <ProForm.Group title="LWA (Login with Amazon) 配置">
              <ProFormText
                name="SP_API_LWA_CLIENT_ID"
                label="LWA Client ID"
                placeholder="请输入LWA Client ID"
                rules={[{ required: true, message: '请输入LWA Client ID' }]}
                fieldProps={{
                  style: { width: '100%' },
                }}
              />
              <ProFormText.Password
                name="SP_API_LWA_CLIENT_SECRET"
                label="LWA Client Secret"
                placeholder="请输入LWA Client Secret"
                rules={[{ required: true, message: '请输入LWA Client Secret' }]}
                fieldProps={{
                  style: { width: '100%' },
                }}
              />
              <ProFormText.Password
                name="SP_API_REFRESH_TOKEN"
                label="Refresh Token"
                placeholder="请输入Refresh Token"
                rules={[{ required: true, message: '请输入Refresh Token' }]}
                fieldProps={{
                  style: { width: '100%' },
                }}
              />
            </ProForm.Group>

            <ProForm.Group title="AWS IAM 配置">
              <ProFormText
                name="SP_API_ACCESS_KEY_ID"
                label="AWS Access Key ID"
                placeholder="请输入AWS Access Key ID"
                rules={[{ required: true, message: '请输入AWS Access Key ID' }]}
                fieldProps={{
                  style: { width: '100%' },
                }}
              />
              <ProFormText.Password
                name="SP_API_SECRET_ACCESS_KEY"
                label="AWS Secret Access Key"
                placeholder="请输入AWS Secret Access Key"
                rules={[
                  { required: true, message: '请输入AWS Secret Access Key' },
                ]}
                fieldProps={{
                  style: { width: '100%' },
                }}
              />
              <ProFormText
                name="SP_API_ROLE_ARN"
                label="AWS IAM Role ARN"
                placeholder="请输入AWS IAM Role ARN"
                rules={[{ required: true, message: '请输入AWS IAM Role ARN' }]}
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
