import services from '@/services/user';
import { useMessage } from '@/utils/message';
import { ModalForm, ProFormText } from '@ant-design/pro-components';
import React from 'react';

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

  const handleSubmit = async (formValues: { newPassword: string }) => {
    if (!userId) {
      message.error('用户ID不存在');
      return false;
    }

    try {
      await updateUserPassword(userId, {
        newPassword: formValues.newPassword,
      });
      message.success('密码修改成功');
      onSubmit();
      return true;
    } catch (error: any) {
      console.error('修改密码错误:', error);
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
      modalProps={{
        destroyOnHidden: true,
      }}
    >
      <ProFormText.Password
        name="newPassword"
        label="新密码"
        placeholder="请输入新密码（至少6位）"
        rules={[
          { required: true, message: '请输入新密码' },
          { min: 6, message: '密码长度至少为6位' },
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
    </ModalForm>
  );
};

export default PasswordForm;
