import services from '@/services/feishu';
import { useMessage } from '@/utils/message';
import type { ActionType } from '@ant-design/pro-components';
import {
  PageContainer,
  ProColumns,
  ProTable,
} from '@ant-design/pro-components';
import { Button, Form, Input, Modal, Popconfirm, Space, Switch } from 'antd';
import React, { useRef, useState } from 'react';

const {
  getFeishuConfigs,
  upsertFeishuConfig,
  deleteFeishuConfig,
  toggleFeishuConfig,
} = services.FeishuController;

// 区域选项映射（只支持US和EU）
const regionMap: Record<string, string> = {
  US: '美国区域',
  EU: '欧洲区域（UK、DE、FR、IT、ES）',
};

const FeishuConfigPage: React.FC<unknown> = () => {
  const message = useMessage();
  const actionRef = useRef<ActionType>();
  const [modalVisible, setModalVisible] = useState(false);
  const [editingConfig, setEditingConfig] =
    useState<Partial<API.FeishuConfig>>();
  const [form] = Form.useForm();

  const handleAdd = () => {
    setEditingConfig(undefined);
    form.resetFields();
    setModalVisible(true);
  };

  const handleEdit = (record: API.FeishuConfig) => {
    setEditingConfig(record);
    setModalVisible(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      await upsertFeishuConfig({
        country: values.country,
        webhookUrl: values.webhookUrl,
        enabled: values.enabled,
      });
      message.success(editingConfig ? '更新成功' : '创建成功');
      setModalVisible(false);
      form.resetFields();
      if (actionRef.current) {
        await actionRef.current.reload();
      }
    } catch (error: any) {
      message.error(error?.errorMessage || '操作失败');
    }
  };

  const handleDelete = async (country: string) => {
    try {
      await deleteFeishuConfig({ country });
      message.success('删除成功');
      if (actionRef.current) {
        await actionRef.current.reload();
      }
    } catch (error: any) {
      message.error(error?.errorMessage || '删除失败');
    }
  };

  const handleToggle = async (country: string, enabled: boolean) => {
    try {
      await toggleFeishuConfig({ country }, { enabled });
      message.success(enabled ? '已启用' : '已禁用');
      if (actionRef.current) {
        await actionRef.current.reload();
      }
    } catch (error: any) {
      message.error(error?.errorMessage || '操作失败');
    }
  };

  const columns: ProColumns<API.FeishuConfig>[] = [
    {
      title: '区域',
      dataIndex: 'country',
      width: 200,
      valueType: 'select',
      valueEnum: Object.keys(regionMap).reduce((acc, key) => {
        acc[key] = { text: regionMap[key] };
        return acc;
      }, {} as Record<string, { text: string }>),
      render: (_: any, record: API.FeishuConfig) => {
        return regionMap[record.country || ''] || record.country;
      },
    },
    {
      title: 'Webhook URL',
      dataIndex: 'webhookUrl',
      ellipsis: true,
      copyable: true,
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 100,
      valueType: 'select',
      valueEnum: {
        1: { text: '启用', status: 'Success' },
        0: { text: '禁用', status: 'Default' },
      },
      render: (_: any, record: API.FeishuConfig) => {
        return (
          <Switch
            checked={record.enabled === 1}
            onChange={(checked) => handleToggle(record.country || '', checked)}
          />
        );
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createTime',
      width: 180,
      valueType: 'dateTime',
      hideInSearch: true,
    },
    {
      title: '更新时间',
      dataIndex: 'updateTime',
      width: 180,
      valueType: 'dateTime',
      hideInSearch: true,
    },
    {
      title: '操作',
      dataIndex: 'option',
      valueType: 'option',
      width: 150,
      render: (_: any, record: API.FeishuConfig) => (
        <Space>
          <Button type="link" size="small" onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确定要删除这个配置吗？"
            onConfirm={() => handleDelete(record.country || '')}
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <PageContainer
      header={{
        title: '飞书配置管理',
        breadcrumb: {},
      }}
    >
      <ProTable<API.FeishuConfig>
        headerTitle="飞书配置列表"
        actionRef={actionRef}
        rowKey="country"
        search={{
          labelWidth: 120,
        }}
        toolBarRender={() => [
          <Button key="1" type="primary" onClick={handleAdd}>
            新建配置
          </Button>,
        ]}
        request={async (params) => {
          try {
            const response = await getFeishuConfigs();
            let data: API.FeishuConfig[] = [];

            if (response && typeof response === 'object') {
              if ('data' in response) {
                data = response.data || [];
              } else if (Array.isArray(response)) {
                data = response;
              }
            }

            // 只显示US和EU配置
            data = data.filter(
              (item) => item.country === 'US' || item.country === 'EU',
            );

            // 前端筛选
            if (params.country) {
              data = data.filter((item) => item.country === params.country);
            }
            if (params.enabled !== undefined) {
              data = data.filter((item) => item.enabled === params.enabled);
            }

            return {
              data,
              success: true,
              total: data.length,
            };
          } catch (error) {
            console.error('获取飞书配置失败:', error);
            return {
              data: [],
              success: false,
              total: 0,
            };
          }
        }}
        columns={columns}
      />

      <Modal
        title={editingConfig ? '编辑飞书配置' : '新建飞书配置'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => {
          setModalVisible(false);
          form.resetFields();
        }}
        afterOpenChange={(open) => {
          // Modal 打开后设置表单值
          if (open && editingConfig) {
            form.setFieldsValue({
              country: editingConfig.country,
              webhookUrl: editingConfig.webhookUrl,
              enabled: editingConfig.enabled === 1,
            });
          }
        }}
        width={600}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="country"
            label="区域"
            rules={[{ required: true, message: '请选择区域' }]}
          >
            <Input
              placeholder="请输入区域代码（US或EU）"
              disabled={!!editingConfig}
            />
          </Form.Item>
          <Form.Item
            name="webhookUrl"
            label="Webhook URL"
            rules={[
              { required: true, message: '请输入Webhook URL' },
              { type: 'url', message: '请输入有效的URL' },
            ]}
          >
            <Input.TextArea
              rows={3}
              placeholder="请输入飞书Webhook URL，例如：https://open.feishu.cn/open-apis/bot/v2/hook/xxxxx"
            />
          </Form.Item>
          <Form.Item
            name="enabled"
            label="启用状态"
            valuePropName="checked"
            initialValue={true}
          >
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default FeishuConfigPage;
