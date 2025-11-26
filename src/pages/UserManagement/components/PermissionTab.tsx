import services from '@/services/role';
import { useMessage } from '@/utils/message';
import { Card, Space, Tag, Typography } from 'antd';
import React, { useEffect, useState } from 'react';

const { getPermissionList } = services.RoleController;

const PermissionTab: React.FC = () => {
  const message = useMessage();
  const [groupedPermissions, setGroupedPermissions] = useState<
    Record<string, API.Permission[]>
  >({});
  const [loading, setLoading] = useState(false);

  const loadPermissions = async () => {
    setLoading(true);
    try {
      const response = await getPermissionList();

      let grouped: Record<string, API.Permission[]> = {};

      if (response && typeof response === 'object') {
        if ('data' in response) {
          grouped = response.data?.grouped || {};
        }
      }

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
    <Card loading={loading}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {Object.keys(groupedPermissions).length === 0 ? (
          <Typography.Text type="secondary">
            当前尚未配置权限分组或权限项。
          </Typography.Text>
        ) : (
          Object.entries(groupedPermissions).map(([resource, perms]) => (
            <Card key={resource} size="small" title={resource || '其他'}>
              <Space wrap>
                {perms.map((perm) => (
                  <Tag key={perm.id} color="blue">
                    {perm.name} ({perm.code})
                  </Tag>
                ))}
              </Space>
            </Card>
          ))
        )}
      </Space>
    </Card>
  );
};

export default PermissionTab;
