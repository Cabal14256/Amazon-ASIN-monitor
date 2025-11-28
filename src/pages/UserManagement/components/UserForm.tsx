import services from '@/services/user';
import { useMessage } from '@/utils/message';
import {
  ModalForm,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
} from '@ant-design/pro-components';
import React, { useEffect, useState } from 'react';

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
    } catch (error) {
      console.error('加载角色列表失败:', error);
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
          status: formValues.status ? 1 : 0,
          roleIds: formValues.roleIds,
        });
        message.success('更新成功');
      } else {
        await createUser({
          username: formValues.username,
          password: formValues.password,
          real_name: formValues.real_name,
          roleIds: formValues.roleIds,
        });
        message.success('创建成功');
      }
      onSubmit();
      return true;
    } catch (error: any) {
      console.error('保存用户错误:', error);
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
        status: values?.status === 1,
        roleIds: values?.roles?.map((r) => r.id) || [],
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
          placeholder="请输入密码（至少6位）"
          rules={[
            { required: true, message: '请输入密码' },
            { min: 6, message: '密码长度至少为6位' },
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
        <ProFormSwitch
          name="status"
          label="状态"
          checkedChildren="启用"
          unCheckedChildren="禁用"
        />
      )}
    </ModalForm>
  );
};

export default UserForm;
