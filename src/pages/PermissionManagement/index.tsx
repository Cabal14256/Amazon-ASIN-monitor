import services from '@/services/role';
import { useMessage } from '@/utils/message';
import { PageContainer } from '@ant-design/pro-components';
import { Card, Space, Tag } from 'antd';
import React, { useEffect, useState } from 'react';

const { getPermissionList } = services.RoleController;

const PermissionManagement: React.FC<unknown> = () => {
  const message = useMessage();
  const [, setPermissions] = useState<API.Permission[]>([]);
  const [groupedPermissions, setGroupedPermissions] = useState<
    Record<string, API.Permission[]>
  >({});
  const [loading, setLoading] = useState(false);

  const loadPermissions = async () => {
    setLoading(true);
    try {
      const response = await getPermissionList();

      let data: API.Permission[] = [];
      let grouped: Record<string, API.Permission[]> = {};

      if (response && typeof response === 'object') {
        if ('data' in response) {
          data = response.data?.list || [];
          grouped = response.data?.grouped || {};
        }
      }

      setPermissions(data);
      setGroupedPermissions(grouped);
    } catch (error: any) {
      console.error('获取权限列表失败:', error);
      const errorMessage =
        error?.response?.data?.errorMessage ||
        error?.data?.errorMessage ||
        error?.errorMessage ||
        error?.message ||
        '获取权限列表失败';
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPermissions();
  }, []);

  return (
    <PageContainer
      header={{
        title: '权限管理',
        breadcrumb: {},
      }}
    >
      <Card loading={loading}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {Object.keys(groupedPermissions).map((resource) => (
            <Card key={resource} size="small" title={resource || '其他'}>
              <Space wrap>
                {groupedPermissions[resource].map((perm) => (
                  <Tag key={perm.id} color="blue" style={{ marginBottom: 8 }}>
                    {perm.name} ({perm.code})
                  </Tag>
                ))}
              </Space>
            </Card>
          ))}
        </Space>
      </Card>
    </PageContainer>
  );
};

export default PermissionManagement;
