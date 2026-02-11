import services from '@/services/role';
import { useMessage } from '@/utils/message';
import { ProColumns, ProTable } from '@ant-design/pro-components';
import { useModel } from '@umijs/max';
import {
  Button,
  Card,
  Checkbox,
  Divider,
  Modal,
  Space,
  Tag,
  Typography,
} from 'antd';
import React, { useMemo, useRef, useState } from 'react';

const { getRoleList, getPermissionList, updateRolePermissions } =
  services.RoleController;

const RoleTab: React.FC = () => {
  const message = useMessage();
  const actionRef = useRef<any>();
  const { initialState } = useModel('@@initialState');
  const isCurrentUserAdmin = (initialState?.roles || []).includes('ADMIN');

  const [editVisible, setEditVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [permissionGroups, setPermissionGroups] = useState<
    Record<string, API.Permission[]>
  >({});
  const [editingRole, setEditingRole] = useState<API.Role | null>(null);
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<string[]>(
    [],
  );

  const groupedPermissionEntries = useMemo(
    () =>
      Object.entries(permissionGroups).sort(([a], [b]) =>
        a.localeCompare(b, 'zh-CN'),
      ),
    [permissionGroups],
  );

  const handleOpenEditModal = async (role: API.Role) => {
    try {
      const response = await getPermissionList();
      const grouped =
        (response as API.Result_PermissionList_)?.data?.grouped || {};
      setPermissionGroups(grouped);
      setEditingRole(role);
      setSelectedPermissionIds(
        (role.permissions || []).map((perm) => perm.id || '').filter(Boolean),
      );
      setEditVisible(true);
    } catch (error: any) {
      message.error(error?.errorMessage || '获取权限列表失败');
    }
  };

  const handleSaveRolePermissions = async () => {
    if (!editingRole?.id) {
      return;
    }

    const isEditingAdminRole = editingRole.code === 'ADMIN';
    if (isCurrentUserAdmin && isEditingAdminRole) {
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: '风险提示',
          content:
            '你正在修改 ADMIN 角色权限。该角色通常也包含当前登录账号，保存后权限会立即生效，请确认不会影响当前账号的管理能力。',
          okText: '继续保存',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });

      if (!confirmed) {
        return;
      }
    }

    setSaving(true);
    try {
      await updateRolePermissions(editingRole.id, {
        permissionIds: selectedPermissionIds,
      });
      message.success('角色权限更新成功');
      setEditVisible(false);
      setEditingRole(null);
      actionRef.current?.reload();
    } catch (error: any) {
      message.error(error?.errorMessage || '更新角色权限失败');
    } finally {
      setSaving(false);
    }
  };

  const columns: ProColumns<API.Role>[] = [
    {
      title: '角色代码',
      dataIndex: 'code',
      width: 120,
    },
    {
      title: '角色名称',
      dataIndex: 'name',
      width: 150,
    },
    {
      title: '描述',
      dataIndex: 'description',
      width: 200,
      ellipsis: true,
    },
    {
      title: '权限',
      dataIndex: 'permissions',
      width: 400,
      render: (_: any, record: API.Role) => (
        <Space wrap>
          {record.permissions?.map((perm) => (
            <Tag key={perm.id} color="blue">
              {perm.name}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'create_time',
      width: 180,
      valueType: 'dateTime',
      hideInSearch: true,
    },
    {
      title: '操作',
      width: 120,
      hideInSearch: true,
      render: (_: any, record: API.Role) => (
        <Button
          type="link"
          disabled={!isCurrentUserAdmin}
          onClick={() => handleOpenEditModal(record)}
        >
          编辑权限
        </Button>
      ),
    },
  ];

  return (
    <>
      <Card>
        <ProTable<API.Role>
          headerTitle="角色列表"
          actionRef={actionRef}
          rowKey="id"
          search={false}
          request={async () => {
            try {
              const response = await getRoleList();

              let data: API.Role[] = [];
              if (response && typeof response === 'object') {
                if ('data' in response) {
                  data = response.data || [];
                } else if (Array.isArray(response)) {
                  data = response;
                }
              }

              return {
                data,
                success: true,
                total: data.length,
              };
            } catch (error: any) {
              const errorMessage =
                error?.response?.data?.errorMessage ||
                error?.data?.errorMessage ||
                error?.errorMessage ||
                error?.message ||
                '获取角色列表失败';
              message.error(errorMessage);
              return {
                data: [],
                success: false,
                total: 0,
              };
            }
          }}
          columns={columns}
          pagination={false}
        />
        {!isCurrentUserAdmin && (
          <Typography.Text type="secondary">
            仅管理员可编辑角色权限。
          </Typography.Text>
        )}
      </Card>

      <Modal
        title={`编辑角色权限${
          editingRole?.name ? ` - ${editingRole.name}` : ''
        }`}
        open={editVisible}
        onCancel={() => {
          setEditVisible(false);
          setEditingRole(null);
        }}
        onOk={handleSaveRolePermissions}
        confirmLoading={saving}
        width={820}
      >
        {isCurrentUserAdmin && editingRole?.code === 'ADMIN' && (
          <Typography.Paragraph type="warning">
            注意：你正在编辑 ADMIN 角色，保存后可能影响当前登录账号权限。
          </Typography.Paragraph>
        )}

        {groupedPermissionEntries.map(([resource, permissions]) => (
          <div key={resource}>
            <Typography.Text strong>{resource}</Typography.Text>
            <div style={{ marginTop: 8, marginBottom: 8 }}>
              <Checkbox.Group
                value={selectedPermissionIds}
                onChange={(values) =>
                  setSelectedPermissionIds(values as string[])
                }
                options={permissions.map((permission) => ({
                  label: `${permission.name} (${permission.code})`,
                  value: permission.id || '',
                }))}
              />
            </div>
            <Divider style={{ margin: '12px 0' }} />
          </div>
        ))}
      </Modal>
    </>
  );
};

export default RoleTab;
