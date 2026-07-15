import services from '@/services/asin';
import { useMessage } from '@/utils/message';
import {
  ModalForm,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const { batchCreateASINs, modifyASIN, queryVariantGroupList } =
  services.ASINController;

const ASIN_CODE_PATTERN = /^[A-Z0-9]{10}$/;

const splitASINCodes = (value?: string) =>
  String(value || '')
    .split(/[\s,，;；]+/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);

const uniqueASINCodes = (codes: string[]) => Array.from(new Set(codes));

const getErrorMessage = (error: any, fallback: string) =>
  error?.errorMessage || error?.message || fallback;

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
      const { data } = await queryVariantGroupList({
        current: 1,
        pageSize: 1000,
      });
      setVariantGroups(data?.list || []);
    } catch (error) {
      console.error('加载变体组列表失败:', error);
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
          await modifyASIN(
            {
              asinId: values?.id || '',
            },
            {
              ...formValues,
              asin: formValues.asin?.trim().toUpperCase(),
            },
          );
          message.success('更新成功');
        } else {
          const asinCodes = uniqueASINCodes(splitASINCodes(formValues.asin));
          const response = await batchCreateASINs({
            items: asinCodes.map((asin) => ({
              ...formValues,
              asin,
            })),
          });
          const batchResult = response?.data || response;
          const successCount = Number(batchResult?.successCount || 0);
          const failures: Array<{ asin: string; message: string }> = (
            batchResult?.errors || []
          ).map((error: any) => ({
            asin: error.asin || '',
            message: error.message || '创建失败',
          }));

          if (failures.length > 0) {
            const failureSummary = failures
              .slice(0, 3)
              .map((item) => `${item.asin}: ${item.message}`)
              .join('；');
            const moreText =
              failures.length > 3 ? `，另有 ${failures.length - 3} 个失败` : '';

            if (successCount === 0) {
              message.error(`创建失败：${failureSummary}${moreText}`);
              return false;
            }

            message.warning(
              `已添加 ${successCount} 个ASIN，失败 ${failures.length} 个：${failureSummary}${moreText}`,
            );
          } else {
            message.success(
              asinCodes.length > 1
                ? `创建成功，共添加 ${asinCodes.length} 个ASIN`
                : '创建成功',
            );
          }
        }
        onSubmit();
        return true;
      } catch (error: any) {
        message.error(getErrorMessage(error, isEdit ? '更新失败' : '创建失败'));
        return false;
      } finally {
        submittingRef.current = false;
      }
    },
    [isEdit, values?.id, onSubmit, message],
  );

  return (
    <ModalForm
      title={isEdit ? '编辑ASIN' : '添加ASIN'}
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
      {isEdit ? (
        <ProFormText
          name="asin"
          label="ASIN编码"
          placeholder="请输入ASIN编码（如：B0CHX1W1XY）"
          rules={[
            { required: true, message: '请输入ASIN编码' },
            {
              pattern: ASIN_CODE_PATTERN,
              message: 'ASIN编码格式不正确（应为10位字母数字组合）',
            },
          ]}
          fieldProps={{
            maxLength: 10,
            style: { textTransform: 'uppercase' },
          }}
          disabled={isEdit} // 编辑时禁用ASIN编码修改
        />
      ) : (
        <ProFormTextArea
          name="asin"
          label="ASIN编码"
          placeholder="可输入多个ASIN，支持换行、逗号、分号或空格分隔"
          rules={[
            { required: true, message: '请输入ASIN编码' },
            {
              validator: async (_rule: unknown, value?: string) => {
                const asinCodes = splitASINCodes(value);
                if (asinCodes.length === 0) {
                  throw new Error('请输入ASIN编码');
                }

                const invalidASINs = asinCodes.filter(
                  (asin) => !ASIN_CODE_PATTERN.test(asin),
                );
                if (invalidASINs.length > 0) {
                  throw new Error(
                    `ASIN编码格式不正确：${invalidASINs
                      .slice(0, 5)
                      .join('、')}`,
                  );
                }
              },
            },
          ]}
          fieldProps={{
            autoSize: { minRows: 3, maxRows: 6 },
            style: { textTransform: 'uppercase' },
          }}
        />
      )}
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
      <ProFormText
        name="site"
        label="站点"
        placeholder="请输入店铺代号（如：12）"
        rules={[{ required: true, message: '请输入站点（店铺代号）' }]}
        fieldProps={{
          maxLength: 100,
        }}
      />
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
