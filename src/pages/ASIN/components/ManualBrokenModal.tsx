import { Form, Input, Modal } from 'antd';
import React, { useEffect, useMemo, useState } from 'react';

interface ManualBrokenModalProps {
  open: boolean;
  targetType: 'group' | 'asin';
  action?: 'mark' | 'exclude';
  record?: Partial<API.VariantGroup | API.ASINInfo>;
  onCancel: () => void;
  onSubmit: (reason: string) => Promise<void>;
}

const ManualBrokenModal: React.FC<ManualBrokenModalProps> = ({
  open,
  targetType,
  action = 'mark',
  record,
  onCancel,
  onSubmit,
}) => {
  const [form] = Form.useForm<{ reason: string }>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        reason: String(
          action === 'exclude'
            ? (record as API.ASINInfo | undefined)?.manualExcludedReason || ''
            : (record as API.ASINInfo | undefined)?.selfManualBrokenReason ||
                record?.manualBrokenReason ||
                '',
        ),
      });
      return;
    }
    form.resetFields();
  }, [action, form, open, record]);

  const isExcludeAction = action === 'exclude';
  const title =
    targetType === 'group'
      ? '人工标记变体组异常'
      : isExcludeAction
      ? '排除父变体人工标记'
      : '人工标记ASIN异常';
  const okText = isExcludeAction ? '确认排除' : '确认标记';
  const reasonLabel = isExcludeAction ? '排除原因' : '异常原因';
  const reasonPlaceholder = isExcludeAction
    ? '例如：该 ASIN 已单独核实正常，不继承父变体人工标记'
    : '例如：副评评论共享受限，业务上判定为异常';

  const summary = useMemo(() => {
    if (!record) {
      return '-';
    }
    if (targetType === 'group') {
      const group = record as API.VariantGroup;
      return `${group.name || '-'} (${group.id || '-'})`;
    }
    const asin = record as API.ASINInfo;
    return `${asin.asin || '-'}${asin.name ? ` / ${asin.name}` : ''}`;
  }, [record, targetType]);

  const handleOk = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      await onSubmit(String(values.reason || '').trim());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={title}
      open={open}
      okText={okText}
      cancelText="取消"
      confirmLoading={submitting}
      destroyOnClose
      onCancel={onCancel}
      onOk={() => {
        void handleOk();
      }}
    >
      <div style={{ marginBottom: 16, color: '#666' }}>对象：{summary}</div>
      <Form form={form} layout="vertical">
        <Form.Item
          name="reason"
          label={reasonLabel}
          rules={[
            {
              required: true,
              message: isExcludeAction
                ? '请填写排除父变体人工标记的原因'
                : '请填写人工异常原因',
            },
            { max: 500, message: '原因长度不能超过500个字符' },
          ]}
        >
          <Input.TextArea
            rows={4}
            placeholder={reasonPlaceholder}
            maxLength={500}
            showCount
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default ManualBrokenModal;
