import services from '@/services/user';
import { useMessage } from '@/utils/message';
import {
  ModalForm,
  ProFormSelect,
  ProFormText,
  ProFormSwitch,
  ProFormTextArea,
} from '@ant-design/pro-components';
import React, { useEffect, useState } from 'react';
import { PASSWORD_POLICY_HINT, validateStrongPassword } from '@/utils/password';

const { createUser, updateUser, getAllRoles } = services.UserController;

interface UserFormProps {
  modalVisible: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  values?: Partial<API.UserInfo>;
}

const UserForm: React.FC<UserFormProps> = (props) => {
  const { modalVisible, onCancel, onSubmit, values } = props;
  const message = useMessage();
  const isEdit = !!values?.id;
  const [roles, setRoles] = useState<API.Role[]>([]);

  // 加载角色列表
  const loadRoles = async () => {
    try {
      const response = await getAllRoles();
      if (response && typeof response === 'object') {
        if ('data' in response) {
          setRoles(response.data || []);
        } else if (Array.isArray(response)) {
          setRoles(response);
        }
      }
    } catch (_error) {
      message.error('加载角色列表失败');
    }
  };

  useEffect(() => {
    if (modalVisible) {
      loadRoles();
    }
  }, [modalVisible]);

  const handleSubmit = async (formValues: any) => {
    try {
      if (isEdit) {
        await updateUser(values.id || '', {
          real_name: formValues.real_name,
          status: formValues.status,
          roleIds: formValues.roleIds,
          statusReason: formValues.statusReason,
        });
        message.success('更新成功');
      } else {
        await createUser({
          username: formValues.username,
          password: formValues.password,
          real_name: formValues.real_name,
          roleIds: formValues.roleIds,
          forcePasswordChange: formValues.forcePasswordChange,
        });
        message.success('创建成功');
      }
      onSubmit();
      return true;
    } catch (error: any) {
      let errorMessage = '保存失败';
      if (error?.response?.data?.errorMessage) {
        errorMessage = error.response.data.errorMessage;
      } else if (error?.data?.errorMessage) {
        errorMessage = error.data.errorMessage;
      } else if (error?.errorMessage) {
        errorMessage = error.errorMessage;
      } else if (error?.message) {
        errorMessage = error.message;
      }
      message.error(errorMessage);
      return false;
    }
  };

  return (
    <ModalForm
      title={isEdit ? '编辑用户' : '新建用户'}
      width={600}
      open={modalVisible}
      onOpenChange={(visible) => {
        if (!visible) onCancel();
      }}
      onFinish={handleSubmit}
      initialValues={{
        ...values,
        status: values?.status || 'ACTIVE',
        roleIds: values?.roles?.map((r) => r.id) || [],
        forcePasswordChange: true,
      }}
      modalProps={{
        destroyOnHidden: true,
      }}
    >
      <ProFormText
        name="username"
        label="用户名"
        placeholder="请输入用户名"
        rules={[{ required: !isEdit, message: '请输入用户名' }]}
        disabled={isEdit}
        fieldProps={{
          maxLength: 50,
        }}
      />
      {!isEdit && (
        <ProFormText.Password
          name="password"
          label="密码"
          placeholder={`请输入密码（${PASSWORD_POLICY_HINT}）`}
          rules={[
            { required: true, message: '请输入密码' },
            {
              validator: async (_, value) => {
                const error = validateStrongPassword(value);
                if (error) {
                  return Promise.reject(new Error(error));
                }
                return Promise.resolve();
              },
            },
          ]}
        />
      )}
      <ProFormText
        name="real_name"
        label="真实姓名"
        placeholder="请输入真实姓名"
        fieldProps={{
          maxLength: 100,
        }}
      />
      {!isEdit && (
        <ProFormSwitch
          name="forcePasswordChange"
          label="首次登录强制改密"
          checkedChildren="是"
          unCheckedChildren="否"
        />
      )}
      <ProFormSelect
        name="roleIds"
        label="角色"
        placeholder="请选择角色"
        mode="multiple"
        options={roles.map((role) => ({
          label: role.name,
          value: role.id,
        }))}
        rules={[{ required: true, message: '请至少选择一个角色' }]}
      />
      {isEdit && (
        <ProFormSelect
          name="status"
          label="状态"
          options={[
            { label: '启用', value: 'ACTIVE' },
            { label: '停用', value: 'INACTIVE' },
            { label: '锁定', value: 'LOCKED' },
            { label: '暂停', value: 'SUSPENDED' },
            { label: '待激活', value: 'PENDING' },
          ]}
          rules={[{ required: true, message: '请选择用户状态' }]}
        />
      )}
      {isEdit && (
        <ProFormTextArea
          name="statusReason"
          label="状态变更原因"
          placeholder="如有状态变更，请填写原因"
          fieldProps={{
            maxLength: 255,
            showCount: true,
          }}
        />
      )}
    </ModalForm>
  );
};

export default UserForm;
