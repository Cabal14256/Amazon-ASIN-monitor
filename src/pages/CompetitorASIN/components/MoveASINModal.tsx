import services from '@/services/competitor';
import { debugError } from '@/utils/debug';
import { useMessage } from '@/utils/message';
import { Modal, Select, Typography } from 'antd';
import React, { useEffect, useState } from 'react';

const { moveCompetitorASIN, queryCompetitorVariantGroupList } =
  services.CompetitorASINController;

interface MoveASINModalProps {
  visible: boolean;
  asinId?: string;
  currentGroupId?: string;
  currentCountry?: string;
  onCancel: () => void;
  onSuccess: () => void;
}

const MoveASINModal: React.FC<MoveASINModalProps> = (props) => {
  const {
    visible,
    asinId,
    currentGroupId,
    currentCountry,
    onCancel,
    onSuccess,
  } = props;
  const message = useMessage();
  const [targetGroupId, setTargetGroupId] = useState<string>();
  const [variantGroups, setVariantGroups] = useState<API.VariantGroup[]>([]);
  const [loading, setLoading] = useState(false);

  const loadVariantGroups = async () => {
    try {
      const response = await queryCompetitorVariantGroupList({
        current: 1,
        pageSize: 1000,
      });
      const payload =
        response && typeof response === 'object' && 'data' in response
          ? response.data
          : response;
      const list =
        payload &&
        typeof payload === 'object' &&
        'list' in payload &&
        Array.isArray(payload.list)
          ? (payload.list as API.VariantGroup[])
          : [];
      // 过滤掉当前变体组
      const groups = list.filter(
        (group: API.VariantGroup) =>
          group.id !== currentGroupId &&
          (!currentCountry || group.country === currentCountry),
      );
      setVariantGroups(groups);
    } catch (error) {
      debugError('加载竞品变体组列表失败:', error);
      message.error('加载竞品变体组列表失败');
    }
  };

  useEffect(() => {
    if (visible) {
      loadVariantGroups();
      setTargetGroupId(undefined);
    }
  }, [visible, currentGroupId, currentCountry]);

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
      await moveCompetitorASIN({ asinId }, { targetGroupId });
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
      title="移动竞品ASIN到变体组"
      open={visible}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={loading}
      okText="确定"
      cancelText="取消"
    >
      <div style={{ marginBottom: 16 }}>
        <Typography.Text style={{ display: 'block', marginBottom: 8 }}>
          选择目标变体组：
        </Typography.Text>
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
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          没有可用的同国家变体组（已排除当前变体组）
        </Typography.Text>
      )}
    </Modal>
  );
};

export default MoveASINModal;
