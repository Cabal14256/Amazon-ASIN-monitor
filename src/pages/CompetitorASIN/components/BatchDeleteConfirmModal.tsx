import { Modal, Tag } from 'antd';
import React from 'react';

interface BatchDeleteConfirmModalProps {
  visible: boolean;
  items: (API.VariantGroup | API.ASINInfo)[];
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

const BatchDeleteConfirmModal: React.FC<BatchDeleteConfirmModalProps> = ({
  visible,
  items,
  onConfirm,
  onCancel,
  loading = false,
}) => {
  // 分类统计
  const groups = items.filter(
    (item) => (item as API.VariantGroup).parentId === undefined,
  ) as API.VariantGroup[];
  const asins = items.filter(
    (item) => (item as API.VariantGroup).parentId !== undefined,
  ) as API.ASINInfo[];

  // 统计变体组下的ASIN数量（如果有children）
  const totalAsinsInGroups = groups.reduce((total, group) => {
    return total + (group.children?.length || 0);
  }, 0);

  const hasGroups = groups.length > 0;
  const hasAsins = asins.length > 0;
  const willDeleteNestedAsins = hasGroups && totalAsinsInGroups > 0;

  return (
    <Modal
      title="确认删除"
      open={visible}
      onOk={onConfirm}
      onCancel={onCancel}
      confirmLoading={loading}
      okText="确认删除"
      cancelText="取消"
      okButtonProps={{ danger: true }}
      width={600}
    >
      <div style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
          您确定要删除以下 {items.length} 项吗？
        </p>
      </div>

      {/* 统计信息 */}
      <div
        style={{
          marginBottom: 16,
          padding: 12,
          background: '#f5f5f5',
          borderRadius: 4,
        }}
      >
        {hasGroups && (
          <div style={{ marginBottom: 8 }}>
            <Tag color="blue">变体组</Tag>
            <span style={{ marginLeft: 8 }}>{groups.length} 个</span>
            {willDeleteNestedAsins && (
              <span style={{ marginLeft: 8, color: '#ff4d4f' }}>
                （将同时删除其下的 {totalAsinsInGroups} 个 ASIN）
              </span>
            )}
          </div>
        )}
        {hasAsins && (
          <div>
            <Tag color="default">ASIN</Tag>
            <span style={{ marginLeft: 8 }}>{asins.length} 个</span>
          </div>
        )}
      </div>

      {/* 警告提示 */}
      {willDeleteNestedAsins && (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            background: '#fff7e6',
            border: '1px solid #ffd591',
            borderRadius: 4,
          }}
        >
          <p style={{ margin: 0, color: '#d46b08', fontWeight: 600 }}>
            ⚠️ 警告：删除变体组将同时删除该变体组下的所有 ASIN！
          </p>
        </div>
      )}

      {/* 删除项列表（最多显示10个） */}
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        <p style={{ fontWeight: 600, marginBottom: 8 }}>删除项列表：</p>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {items.slice(0, 10).map((item) => {
            const isGroup = (item as API.VariantGroup).parentId === undefined;
            return (
              <li key={item.id} style={{ marginBottom: 4 }}>
                {isGroup ? (
                  <>
                    <Tag color="blue">变体组</Tag>
                    <span style={{ marginLeft: 8 }}>
                      {item.name || item.id}
                    </span>
                    {item.country && (
                      <Tag color="default" style={{ marginLeft: 8 }}>
                        {item.country}
                      </Tag>
                    )}
                    {(item as API.VariantGroup).children?.length > 0 && (
                      <span
                        style={{ marginLeft: 8, color: '#999', fontSize: 12 }}
                      >
                        （包含 {(item as API.VariantGroup).children.length} 个
                        ASIN）
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <Tag color="default">ASIN</Tag>
                    <span style={{ marginLeft: 8, fontFamily: 'monospace' }}>
                      {(item as API.ASINInfo).asin || item.name || item.id}
                    </span>
                    {item.country && (
                      <Tag color="default" style={{ marginLeft: 8 }}>
                        {item.country}
                      </Tag>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
        {items.length > 10 && (
          <p style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
            还有 {items.length - 10} 项未显示...
          </p>
        )}
      </div>

      <div style={{ marginTop: 16, color: '#ff4d4f' }}>
        <p style={{ margin: 0, fontWeight: 600 }}>
          此操作不可撤销，请谨慎操作！
        </p>
      </div>
    </Modal>
  );
};

export default BatchDeleteConfirmModal;
