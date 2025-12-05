import services from '@/services/competitor';
import { useMessage } from '@/utils/message';
import {
  ModalForm,
  ProFormSelect,
  ProFormText,
} from '@ant-design/pro-components';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const {
  addCompetitorASIN,
  modifyCompetitorASIN,
  queryCompetitorVariantGroupList,
} = services.CompetitorASINController;

interface ASINFormProps {
  modalVisible: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  values?: Partial<API.ASINInfo>;
  variantGroupId?: string; // 如果从变体组添加，传入变体组ID
  variantGroupCountry?: string; // 如果从变体组添加，传入变体组的国家
}

const ASINForm: React.FC<ASINFormProps> = (props) => {
  const {
    modalVisible,
    onCancel,
    onSubmit,
    values,
    variantGroupId,
    variantGroupCountry,
  } = props;
  const message = useMessage();
  const isEdit = !!values?.id;
  const [variantGroups, setVariantGroups] = useState<API.VariantGroup[]>([]);
  const submittingRef = useRef(false); // 防重复提交标志

  const loadVariantGroupsMemo = useCallback(async () => {
    try {
      const response = await queryCompetitorVariantGroupList({
        current: 1,
        pageSize: 1000,
      });
      const data = response.data || response;
      setVariantGroups(data?.list || []);
    } catch (error) {
      console.error('加载竞品变体组列表失败:', error);
    }
  }, []);

  useEffect(() => {
    if (modalVisible && !isEdit) {
      loadVariantGroupsMemo();
    }
  }, [modalVisible, isEdit, loadVariantGroupsMemo]);

  const variantGroupOptions = useMemo(
    () =>
      variantGroups.map((group) => ({
        label: `${group.name} (${group.country})`,
        value: group.id,
      })),
    [variantGroups],
  );

  const initialValues = useMemo(
    () => ({
      ...values,
      parentId: variantGroupId || values?.parentId,
      country: variantGroupCountry || values?.country,
      asinType: values?.asinType,
    }),
    [values, variantGroupId, variantGroupCountry],
  );

  const handleSubmit = useCallback(
    async (formValues: API.ASINInfoVO) => {
      // 防重复提交
      if (submittingRef.current) {
        return false;
      }
      submittingRef.current = true;

      try {
        if (isEdit) {
          await modifyCompetitorASIN(
            {
              asinId: values?.id || '',
            },
            formValues,
          );
          message.success('更新成功');
        } else {
          await addCompetitorASIN(formValues);
          message.success('创建成功');
        }
        onSubmit();
        return true;
      } catch (error: any) {
        message.error(
          error?.errorMessage || (isEdit ? '更新失败' : '创建失败'),
        );
        return false;
      } finally {
        submittingRef.current = false;
      }
    },
    [isEdit, values?.id, onSubmit, message],
  );

  return (
    <ModalForm
      title={isEdit ? '编辑竞品ASIN' : '添加竞品ASIN'}
      width={500}
      open={modalVisible}
      onOpenChange={(visible) => {
        if (!visible) onCancel();
      }}
      onFinish={handleSubmit}
      initialValues={initialValues}
      modalProps={{
        destroyOnHidden: true,
      }}
    >
      <ProFormSelect
        name="parentId"
        label="所属变体组"
        placeholder="请选择变体组"
        rules={[{ required: true, message: '请选择变体组' }]}
        disabled={isEdit || !!variantGroupId} // 编辑时或已指定变体组时禁用
        options={variantGroupOptions}
      />
      <ProFormText
        name="asin"
        label="ASIN编码"
        placeholder="请输入ASIN编码（如：B0CHX1W1XY）"
        rules={[
          { required: true, message: '请输入ASIN编码' },
          {
            pattern: /^[A-Z0-9]{10}$/,
            message: 'ASIN编码格式不正确（应为10位字母数字组合）',
          },
        ]}
        fieldProps={{
          maxLength: 10,
          style: { textTransform: 'uppercase' },
        }}
        disabled={isEdit} // 编辑时禁用ASIN编码修改
      />
      <ProFormSelect
        name="country"
        label="所属国家"
        placeholder="请选择国家"
        rules={[{ required: true, message: '请选择国家' }]}
        disabled={!!variantGroupCountry} // 如果从变体组添加，国家字段禁用（已自动设置）
        options={[
          { label: '美国 (US)', value: 'US' },
          { label: '英国 (EU)', value: 'UK' },
          { label: '德国 (EU)', value: 'DE' },
          { label: '法国 (EU)', value: 'FR' },
          { label: '意大利 (EU)', value: 'IT' },
          { label: '西班牙 (EU)', value: 'ES' },
        ]}
      />
      <ProFormSelect
        name="asinType"
        label="ASIN类型"
        placeholder="请选择ASIN类型（可选）"
        options={[
          { label: '主链', value: '1' },
          { label: '副评', value: '2' },
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

export default React.memo(ASINForm);
