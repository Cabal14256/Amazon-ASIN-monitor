import services from '@/services/asin';
import { Modal, Select } from 'antd';
import React, { useEffect, useState } from 'react';
import { useMessage } from '@/utils/message';

const { moveASIN, queryVariantGroupList } = services.ASINController;

interface MoveASINModalProps {
  visible: boolean;
  asinId?: string;
  currentGroupId?: string;
  onCancel: () => void;
  onSuccess: () => void;
}

const MoveASINModal: React.FC<MoveASINModalProps> = (props) => {
  const { visible, asinId, currentGroupId, onCancel, onSuccess } = props;
  const message = useMessage();
  const [targetGroupId, setTargetGroupId] = useState<string>();
  const [variantGroups, setVariantGroups] = useState<API.VariantGroup[]>([]);
  const [loading, setLoading] = useState(false);

  const loadVariantGroups = async () => {
    try {
      const { data } = await queryVariantGroupList({
        current: 1,
        pageSize: 1000,
      });
      // 过滤掉当前变体组
      const groups = (data?.list || []).filter(
        (group) => group.id !== currentGroupId,
      );
      setVariantGroups(groups);
    } catch (error) {
      console.error('加载变体组列表失败:', error);
      message.error('加载变体组列表失败');
    }
  };

  useEffect(() => {
    if (visible) {
      loadVariantGroups();
      setTargetGroupId(undefined);
    }
  }, [visible, currentGroupId]);

  const handleOk = async () => {
    if (!targetGroupId) {
      message.warning('请选择目标变体组');
      return;
    }
    if (!asinId) {
      message.error('ASIN ID不存在');
      return;
    }

    setLoading(true);
    try {
      await moveASIN({ asinId }, { targetGroupId });
      message.success('移动成功');
      onSuccess();
      onCancel();
    } catch (error: any) {
      message.error(error?.errorMessage || '移动失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="移动到变体组"
      open={visible}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
      okText="确定"
      cancelText="取消"
    >
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', marginBottom: 8 }}>
          选择目标变体组：
        </label>
        <Select
          style={{ width: '100%' }}
          placeholder="请选择目标变体组"
          value={targetGroupId}
          onChange={setTargetGroupId}
          showSearch
          filterOption={(input, option) =>
            (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
          }
          options={variantGroups.map((group) => ({
            label: `${group.name} (${group.country})`,
            value: group.id,
          }))}
        />
      </div>
      {variantGroups.length === 0 && (
        <div style={{ color: '#999', fontSize: 12 }}>
          没有可用的变体组（已排除当前变体组）
        </div>
      )}
    </Modal>
  );
};

export default MoveASINModal;
