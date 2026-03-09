import services from '@/services/user';
import { useMessage } from '@/utils/message';
import {
  ModalForm,
  ProFormSwitch,
  ProFormText,
} from '@ant-design/pro-components';
import React from 'react';
import { PASSWORD_POLICY_HINT, validateStrongPassword } from '@/utils/password';

const { updateUserPassword } = services.UserController;

interface PasswordFormProps {
  modalVisible: boolean;
  userId?: string;
  onCancel: () => void;
  onSubmit: () => void;
}

const PasswordForm: React.FC<PasswordFormProps> = (props) => {
  const { modalVisible, onCancel, onSubmit, userId } = props;
  const message = useMessage();

  const handleSubmit = async (formValues: {
    newPassword: string;
    forceChangeOnNextLogin?: boolean;
    revokeAllSessions?: boolean;
  }) => {
    if (!userId) {
      message.error('用户ID不存在');
      return false;
    }

    try {
      await updateUserPassword(userId, {
        newPassword: formValues.newPassword,
        forceChangeOnNextLogin: formValues.forceChangeOnNextLogin,
        revokeAllSessions: formValues.revokeAllSessions,
      });
      message.success('密码修改成功');
      onSubmit();
      return true;
    } catch (error: any) {
      let errorMessage = '修改密码失败';
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
      title="修改密码"
      width={500}
      open={modalVisible}
      onOpenChange={(visible) => {
        if (!visible) onCancel();
      }}
      onFinish={handleSubmit}
      initialValues={{
        forceChangeOnNextLogin: true,
        revokeAllSessions: true,
      }}
      modalProps={{
        destroyOnHidden: true,
      }}
    >
      <ProFormText.Password
        name="newPassword"
        label="新密码"
        placeholder={`请输入新密码（${PASSWORD_POLICY_HINT}）`}
        rules={[
          { required: true, message: '请输入新密码' },
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
      <ProFormText.Password
        name="confirmPassword"
        label="确认密码"
        placeholder="请再次输入新密码"
        dependencies={['newPassword']}
        rules={[
          { required: true, message: '请确认新密码' },
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue('newPassword') === value) {
                return Promise.resolve();
              }
              return Promise.reject(new Error('两次输入的密码不一致'));
            },
          }),
          ]}
        />
      <ProFormSwitch
        name="forceChangeOnNextLogin"
        label="下次登录强制改密"
        initialValue
        checkedChildren="是"
        unCheckedChildren="否"
      />
      <ProFormSwitch
        name="revokeAllSessions"
        label="立即踢出所有会话"
        initialValue
        checkedChildren="是"
        unCheckedChildren="否"
      />
    </ModalForm>
  );
};

export default PasswordForm;
