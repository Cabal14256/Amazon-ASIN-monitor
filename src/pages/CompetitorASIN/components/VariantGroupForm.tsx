import services from '@/services/competitor';
import { useMessage } from '@/utils/message';
import {
  ModalForm,
  ProFormSelect,
  ProFormText,
} from '@ant-design/pro-components';
import React from 'react';

const { addCompetitorVariantGroup, modifyCompetitorVariantGroup } =
  services.CompetitorASINController;

interface VariantGroupFormProps {
  modalVisible: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  values?: Partial<API.VariantGroup>;
}

const VariantGroupForm: React.FC<VariantGroupFormProps> = (props) => {
  const { modalVisible, onCancel, onSubmit, values } = props;
  const message = useMessage();
  const isEdit = !!values?.id;

  const handleSubmit = async (formValues: API.VariantGroupVO) => {
    try {
      if (isEdit) {
        await modifyCompetitorVariantGroup(
          {
            groupId: values.id || '',
          },
          formValues,
        );
        message.success('更新成功');
      } else {
        await addCompetitorVariantGroup(formValues);
        message.success('创建成功');
      }
      onSubmit();
      return true;
    } catch (error: any) {
      console.error('创建变体组错误:', error);
      // 处理各种错误格式
      let errorMessage = '创建失败';
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
      title={isEdit ? '编辑竞品变体组' : '新建竞品变体组'}
      width={500}
      open={modalVisible}
      onOpenChange={(visible) => {
        if (!visible) onCancel();
      }}
      onFinish={handleSubmit}
      initialValues={values}
      modalProps={{
        destroyOnHidden: true,
      }}
    >
      <ProFormText
        name="name"
        label="变体组名称"
        placeholder="请输入变体组名称"
        rules={[{ required: true, message: '请输入变体组名称' }]}
        fieldProps={{
          maxLength: 255,
        }}
      />
      <ProFormSelect
        name="country"
        label="所属国家"
        placeholder="请选择国家"
        rules={[{ required: true, message: '请选择国家' }]}
        options={[
          { label: '美国 (US)', value: 'US' },
          { label: '英国 (EU)', value: 'UK' },
          { label: '德国 (EU)', value: 'DE' },
          { label: '法国 (EU)', value: 'FR' },
          { label: '意大利 (EU)', value: 'IT' },
          { label: '西班牙 (EU)', value: 'ES' },
        ]}
      />
      {/* 竞品监控不需要站点字段，已移除 */}
      <ProFormText
        name="brand"
        label="品牌"
        placeholder="请输入品牌"
        rules={[{ required: true, message: '请输入品牌' }]}
        fieldProps={{
          maxLength: 100,
        }}
      />
    </ModalForm>
  );
};

export default VariantGroupForm;
