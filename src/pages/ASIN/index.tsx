import services from '@/services/asin';
import variantCheckServices from '@/services/variantCheck';
import { useMessage } from '@/utils/message';
import {
  ActionType,
  FooterToolbar,
  PageContainer,
  ProColumns,
  ProTable,
} from '@ant-design/pro-components';
import { Access, history, useAccess } from '@umijs/max';
import type { MenuProps } from 'antd';
import { Button, Dropdown, Space, Switch, Tag } from 'antd';
import dayjs from 'dayjs';
import React, { useRef, useState } from 'react';
import ASINForm from './components/ASINForm';
import ExcelImportModal from './components/ExcelImportModal';
import MoveASINModal from './components/MoveASINModal';
import VariantGroupForm from './components/VariantGroupForm';
import './index.less';

const {
  queryVariantGroupList,
  deleteVariantGroup,
  deleteASIN,
  updateASINFeishuNotify,
  updateVariantGroupFeishuNotify,
} = services.ASINController;
const { checkVariantGroup, checkASIN } =
  variantCheckServices.VariantCheckController;

// 国家选项映射
const countryMap: Record<
  string,
  { text: string; color: string; region: string }
> = {
  US: { text: '美国', color: 'blue', region: 'US' },
  UK: { text: '英国', color: 'green', region: 'EU' },
  DE: { text: '德国', color: 'orange', region: 'EU' },
  FR: { text: '法国', color: 'purple', region: 'EU' },
  IT: { text: '意大利', color: 'cyan', region: 'EU' },
  ES: { text: '西班牙', color: 'magenta', region: 'EU' },
};

const ASINManagement: React.FC<unknown> = () => {
  const message = useMessage();
  const actionRef = useRef<ActionType>();
  const requestCacheRef = useRef<
    Map<
      string,
      {
        data: (API.VariantGroup | API.ASINInfo)[];
        total: number;
        timestamp: number;
      }
    >
  >(new Map());
  const CACHE_TTL = 30 * 1000;
  const access = useAccess();

  /**
   * 删除节点
   */
  const handleRemove = async (
    selectedRows: (API.VariantGroup | API.ASINInfo)[],
  ) => {
    const hide = message.loading('正在删除');
    if (!selectedRows || selectedRows.length === 0) return true;
    try {
      // 区分变体组和ASIN进行删除
      for (const row of selectedRows) {
        if ((row as API.VariantGroup).parentId === undefined) {
          // 变体组
          await deleteVariantGroup({
            groupId: row.id || '',
          });
        } else {
          // ASIN
          await deleteASIN({
            asinId: row.id || '',
          });
        }
      }
      hide();
      message.success('删除成功，即将刷新');
      return true;
    } catch (error) {
      hide();
      message.error('删除失败，请重试');
      return false;
    }
  };
  const [selectedRowsState, setSelectedRows] = useState<
    (API.VariantGroup | API.ASINInfo)[]
  >([]);
  const [variantGroupModalVisible, setVariantGroupModalVisible] =
    useState(false);
  const [asinModalVisible, setAsinModalVisible] = useState(false);
  const [editingVariantGroup, setEditingVariantGroup] =
    useState<Partial<API.VariantGroup>>();
  const [editingASIN, setEditingASIN] = useState<Partial<API.ASINInfo>>();
  const [selectedVariantGroupId, setSelectedVariantGroupId] =
    useState<string>();
  const [selectedVariantGroupCountry, setSelectedVariantGroupCountry] =
    useState<string>();
  const [moveModalVisible, setMoveModalVisible] = useState(false);
  const [movingASIN, setMovingASIN] = useState<Partial<API.ASINInfo>>();
  const [excelImportModalVisible, setExcelImportModalVisible] = useState(false);

  // 操作列菜单
  const getActionMenu = (
    record: API.VariantGroup | API.ASINInfo,
  ): MenuProps => {
    const isGroup = (record as API.VariantGroup).parentId === undefined;
    const items: MenuProps['items'] = [
      {
        key: 'monitor',
        label: '查看监控历史',
        onClick: () => {
          const id = record.id || '';
          const type = isGroup ? 'group' : 'asin';
          // 跳转到监控历史页面，带参数
          history.push(`/monitor-history?type=${type}&id=${id}`);
        },
      },
    ];

    // 只有有编辑权限的用户才能看到编辑和移动选项
    if (access.canWriteASIN) {
      items.unshift({
        key: 'edit',
        label: '编辑',
        onClick: () => {
          if (isGroup) {
            setEditingVariantGroup(record as API.VariantGroup);
            setVariantGroupModalVisible(true);
          } else {
            setEditingASIN(record as API.ASINInfo);
            setAsinModalVisible(true);
          }
        },
      });

      // 仅对ASIN显示移动到选项
      if (!isGroup) {
        items.push(
          {
            type: 'divider' as const,
          },
          {
            key: 'move',
            label: '移动到...',
            onClick: () => {
              setMovingASIN(record as API.ASINInfo);
              setMoveModalVisible(true);
            },
          },
        );
      }
    }

    return { items };
  };

  const columns: ProColumns<API.VariantGroup | API.ASINInfo>[] = [
    {
      title: '名称/ASIN',
      dataIndex: 'keyword',
      width: 200,
      hideInTable: true,
      fieldProps: {
        placeholder: '搜索变体组名称或ASIN',
      },
    },
    {
      title: '名称',
      dataIndex: 'name',
      width: 200,
      hideInSearch: true,
      render: (_: any, record: API.VariantGroup | API.ASINInfo) => {
        const isGroup = (record as API.VariantGroup).parentId === undefined;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {isGroup ? (
                <Tag color="blue">变体组</Tag>
              ) : (
                <Tag color="default">ASIN</Tag>
              )}
            </div>
            <div style={{ marginTop: '4px' }}>
              <span>{record.name || '-'}</span>
            </div>
          </div>
        );
      },
    },
    {
      title: 'ASIN',
      dataIndex: 'asin',
      width: 150,
      align: 'left',
      hideInSearch: true,
      render: (_: any, record: API.VariantGroup | API.ASINInfo) => {
        // 变体组不显示ASIN，返回空字符串以保持列对齐
        if ((record as API.VariantGroup).parentId === undefined) {
          return '';
        }
        const asin = (record as API.ASINInfo).asin;
        return <span style={{ fontFamily: 'monospace' }}>{asin || '-'}</span>;
      },
    },
    {
      title: '所属国家',
      dataIndex: 'country',
      width: 120,
      valueType: 'select' as const,
      valueEnum: Object.keys(countryMap).reduce((acc, key) => {
        acc[key] = { text: countryMap[key].text };
        return acc;
      }, {} as Record<string, { text: string }>),
      render: (_: any, record: API.VariantGroup | API.ASINInfo) => {
        const country = record.country || '';
        const countryInfo = countryMap[country];
        return countryInfo ? (
          <Tag color={countryInfo.color}>{countryInfo.text}</Tag>
        ) : (
          '-'
        );
      },
    },
    {
      title: '站点',
      dataIndex: 'site',
      width: 150,
      hideInSearch: true,
      render: (_: any, record: API.VariantGroup | API.ASINInfo) => {
        const text = record.site;
        return text || '-';
      },
    },
    {
      title: '品牌',
      dataIndex: 'brand',
      width: 150,
      hideInSearch: true,
      render: (_: any, record: API.VariantGroup | API.ASINInfo) => {
        const text = record.brand;
        return text || '-';
      },
    },
    {
      title: 'ASIN类型',
      // 不设置 dataIndex，避免 ProTable 的默认值处理
      width: 120,
      hideInSearch: true,
      render: (_: any, record: API.VariantGroup | API.ASINInfo) => {
        // 变体组不显示ASIN类型（与ASIN列判断逻辑一致）
        // 判断方式：没有asin字段，或者parentId为undefined，或者有children属性
        const hasAsin = !!(record as API.ASINInfo).asin;
        const parentId = (record as API.VariantGroup).parentId;
        const hasChildren = Array.isArray(
          (record as API.VariantGroup).children,
        );
        const isGroup = !hasAsin || parentId === undefined || hasChildren;

        if (isGroup) {
          // 对于变体组，返回空字符串（与ASIN列保持一致）
          return '';
        }

        // 对于ASIN，显示ASIN类型
        const asinType = (record as API.ASINInfo).asinType;
        if (asinType === 'MAIN_LINK') {
          return <Tag color="green">主链</Tag>;
        } else if (asinType === 'SUB_REVIEW') {
          return (
            <Tag
              color="default"
              style={{ backgroundColor: '#f5f5f5', color: '#999' }}
            >
              副评
            </Tag>
          );
        }
        // 如果ASIN没有类型，显示"-"
        return '-';
      },
    },
    {
      title: '变体状态',
      dataIndex: 'variantStatus',
      width: 120,
      valueType: 'select' as const,
      valueEnum: {
        NORMAL: { text: '正常', status: 'Success' },
        BROKEN: { text: '异常', status: 'Error' },
      },
      render: (_: any, record: API.VariantGroup | API.ASINInfo) => {
        const isBroken = record.isBroken === 1;
        return (
          <Tag color={isBroken ? 'error' : 'success'}>
            {isBroken ? '异常' : '正常'}
          </Tag>
        );
      },
    },
    {
      title: '更新时间',
      dataIndex: 'updateTime',
      width: 180,
      valueType: 'dateTime',
      hideInSearch: true,
    },
    {
      title: '监控更新时间',
      dataIndex: 'lastCheckTime',
      width: 180,
      valueType: 'dateTime',
      hideInSearch: true,
      render: (_: any, record: API.VariantGroup | API.ASINInfo) => {
        const isGroup = (record as API.VariantGroup).parentId === undefined;
        const lastCheckTime = isGroup
          ? (record as API.VariantGroup).lastCheckTime
          : (record as API.ASINInfo).lastCheckTime;
        // 使用 dayjs 格式化，确保时区与更新时间一致
        if (!lastCheckTime) return '-';
        return dayjs(lastCheckTime).format('YYYY-MM-DD HH:mm:ss');
      },
    },
    {
      title: '飞书通知',
      dataIndex: 'feishuNotifyEnabled',
      width: 120,
      hideInSearch: true,
      render: (_: any, record: API.VariantGroup | API.ASINInfo) => {
        const isGroup = (record as API.VariantGroup).parentId === undefined;
        const enabled = isGroup
          ? (record as API.VariantGroup).feishuNotifyEnabled !== 0
          : (record as API.ASINInfo).feishuNotifyEnabled !== 0;
        return (
          <Switch
            checked={enabled}
            onChange={async (checked) => {
              try {
                if (isGroup) {
                  const group = record as API.VariantGroup;
                  await updateVariantGroupFeishuNotify(
                    { groupId: group.id },
                    { enabled: checked },
                  );
                } else {
                  const asin = record as API.ASINInfo;
                  await updateASINFeishuNotify(
                    { asinId: asin.id },
                    { enabled: checked },
                  );
                }
                message.success(checked ? '已开启飞书通知' : '已关闭飞书通知');
                if (actionRef.current) {
                  await actionRef.current.reload();
                }
              } catch (error: any) {
                message.error(error?.errorMessage || '更新失败');
              }
            }}
          />
        );
      },
    },
    {
      title: '操作',
      dataIndex: 'option',
      valueType: 'option',
      width: 280,
      fixed: 'right',
      render: (_: any, record: API.VariantGroup | API.ASINInfo) => {
        const isGroup = (record as API.VariantGroup).parentId === undefined;
        return (
          <Space>
            <Dropdown menu={getActionMenu(record)} trigger={['click']}>
              <Button type="link" size="small">
                操作
              </Button>
            </Dropdown>
            <Button
              type="link"
              size="small"
              onClick={async () => {
                const hide = message.loading('正在检查...', 0);
                try {
                  if (isGroup) {
                    // 立即检查时强制刷新，不使用缓存
                    await checkVariantGroup({
                      groupId: record.id || '',
                      forceRefresh: true,
                    });
                    message.success('检查完成');
                  } else {
                    // 立即检查时强制刷新，不使用缓存
                    await checkASIN({
                      asinId: record.id || '',
                      forceRefresh: true,
                    });
                    message.success('检查完成');
                  }
                  // 刷新表格
                  if (actionRef.current) {
                    await actionRef.current.reload();
                  }
                } catch (error: any) {
                  message.error(error?.errorMessage || '检查失败');
                } finally {
                  hide();
                }
              }}
            >
              立即检查
            </Button>
            <Access accessible={access.canWriteASIN}>
              {isGroup && (
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    setEditingASIN(undefined);
                    setSelectedVariantGroupId(record.id);
                    setSelectedVariantGroupCountry(
                      (record as API.VariantGroup).country,
                    );
                    setAsinModalVisible(true);
                  }}
                >
                  添加ASIN
                </Button>
              )}
              <Button
                type="link"
                size="small"
                danger
                onClick={async () => {
                  const success = await handleRemove([record]);
                  if (success) {
                    actionRef.current?.reloadAndRest?.();
                  }
                }}
              >
                删除
              </Button>
            </Access>
          </Space>
        );
      },
    },
  ];

  return (
    <PageContainer
      header={{
        title: 'ASIN 管理',
        breadcrumb: {},
      }}
    >
      <ProTable<API.VariantGroup | API.ASINInfo>
        headerTitle="变体组列表"
        actionRef={actionRef}
        rowKey="id"
        search={{
          labelWidth: 120,
        }}
        rowClassName={(record) => {
          // 根据 parentId 判断是变体组还是 ASIN
          const isGroup = (record as API.VariantGroup).parentId === undefined;
          // 变体组使用浅蓝色背景，ASIN 使用浅灰色背景
          return isGroup ? 'variant-group-row' : 'asin-row';
        }}
        onRow={(record) => {
          // 使用内联样式作为备用方案
          const isGroup = (record as API.VariantGroup).parentId === undefined;
          return {
            style: {
              backgroundColor: isGroup ? 'transparent' : '#fffef5',
            },
            className: isGroup ? 'variant-group-row' : 'asin-row',
          };
        }}
        toolBarRender={() => [
          <Access key="new-group" accessible={access.canWriteASIN}>
            <Button
              type="primary"
              onClick={() => {
                setEditingVariantGroup(undefined);
                setVariantGroupModalVisible(true);
              }}
            >
              新建变体组
            </Button>
          </Access>,
          <Access key="excel-import" accessible={access.canWriteASIN}>
            <Button
              onClick={() => {
                setExcelImportModalVisible(true);
              }}
            >
              Excel导入
            </Button>
          </Access>,
          <Access key="new-asin" accessible={access.canWriteASIN}>
            <Button
              onClick={() => {
                setEditingASIN(undefined);
                setSelectedVariantGroupId(undefined);
                setSelectedVariantGroupCountry(undefined);
                setAsinModalVisible(true);
              }}
            >
              添加ASIN
            </Button>
          </Access>,
          <Access key="export" accessible={access.canReadASIN}>
            <Button
              onClick={async () => {
                try {
                  const params = new URLSearchParams();
                  const formValues =
                    actionRef.current?.getFieldsValue?.() || {};
                  if (formValues.keyword)
                    params.append('keyword', formValues.keyword);
                  if (formValues.country)
                    params.append('country', formValues.country);
                  if (formValues.variantStatus)
                    params.append('variantStatus', formValues.variantStatus);

                  const token = localStorage.getItem('token');
                  const url = `/api/v1/export/asin?${params.toString()}`;

                  const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                      Authorization: `Bearer ${token}`,
                    },
                  });

                  if (response.ok) {
                    const blob = await response.blob();
                    const downloadUrl = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = downloadUrl;
                    a.download = `ASIN数据_${
                      new Date().toISOString().split('T')[0]
                    }.xlsx`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(downloadUrl);
                    message.success('导出成功');
                  } else {
                    message.error('导出失败');
                  }
                } catch (error) {
                  console.error('导出失败:', error);
                  message.error('导出失败');
                }
              }}
            >
              导出Excel
            </Button>
          </Access>,
        ]}
        request={async (params) => {
          const cacheKey = JSON.stringify({
            keyword: params.keyword || '',
            country: params.country || '',
            variantStatus: params.variantStatus || '',
            current: params.current || 1,
            pageSize: params.pageSize || 10,
          });
          const cached = requestCacheRef.current.get(cacheKey);
          if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            return {
              data: cached.data,
              success: true,
              total: cached.total,
            };
          }

          try {
            // 只传递后端需要的参数
            const { current, pageSize, keyword, country, variantStatus } =
              params;
            console.log('ProTable请求参数:', {
              current,
              pageSize,
              keyword,
              country,
              variantStatus,
            });
            const response = await queryVariantGroupList({
              current: current || 1,
              pageSize: pageSize || 10,
              keyword: keyword || '', // 确保keyword有值
              country,
              variantStatus,
            });

            // Umi 的 request 默认返回 response.data
            // 后端返回格式: { success: true, data: { list: [], total: 0 } }
            // 所以 response 应该是 { list: [], total: 0 }
            // 但如果响应拦截器返回整个 response，则 response 是 { success: true, data: { list: [], total: 0 } }
            let data;
            let success = true;

            if (response && typeof response === 'object') {
              // 如果 response 有 data 属性，说明是完整的响应对象
              if ('data' in response) {
                data = response.data;
                success = response.success !== false;
              } else if ('list' in response) {
                // 如果 response 直接是 data 对象（有 list 属性）
                data = response;
              } else {
                data = { list: [], total: 0 };
              }
            } else {
              data = { list: [], total: 0 };
            }

            // 处理树形数据，为每个节点添加parentId标记
            const treeData = data?.list?.map((group: any) => {
              const groupWithParentId = {
                ...group,
                parentId: undefined, // 标记为变体组
              };
              // 为每个ASIN添加parentId
              if (group.children) {
                groupWithParentId.children = group.children.map(
                  (asin: any) => ({
                    ...asin,
                    parentId: group.id,
                  }),
                );
              }
              return groupWithParentId;
            });
            const finalData = treeData || [];
            requestCacheRef.current.set(cacheKey, {
              data: finalData,
              total: data?.total || 0,
              timestamp: Date.now(),
            });

            return {
              data: treeData || [],
              success,
              total: data?.total || 0,
            };
          } catch (error) {
            console.error('获取变体组列表失败:', error);
            return {
              data: [],
              success: false,
              total: 0,
            };
          }
        }}
        columns={columns}
        rowSelection={
          access.canWriteASIN
            ? {
                onChange: (_, selectedRows) => setSelectedRows(selectedRows),
              }
            : false
        }
        // 树形表格配置
        defaultExpandAllRows={true}
        childrenColumnName="children"
        pagination={{
          defaultPageSize: 10,
          showSizeChanger: true,
          showQuickJumper: true,
          showTotal: (total, range) =>
            `第 ${range[0]}-${range[1]} 条/总共 ${total} 条`,
          pageSizeOptions: ['10', '20', '50', '100'],
        }}
      />
      {selectedRowsState?.length > 0 && (
        <Access accessible={access.canWriteASIN}>
          <FooterToolbar
            extra={
              <div>
                已选择{' '}
                <a style={{ fontWeight: 600 }}>{selectedRowsState.length}</a>{' '}
                项&nbsp;&nbsp;
              </div>
            }
          >
            <Button
              onClick={async () => {
                await handleRemove(selectedRowsState);
                setSelectedRows([]);
                actionRef.current?.reloadAndRest?.();
              }}
            >
              批量删除
            </Button>
          </FooterToolbar>
        </Access>
      )}
      <VariantGroupForm
        modalVisible={variantGroupModalVisible}
        onCancel={() => {
          setVariantGroupModalVisible(false);
          setEditingVariantGroup(undefined);
        }}
        onSubmit={async () => {
          setVariantGroupModalVisible(false);
          setEditingVariantGroup(undefined);
          // 确保表格刷新
          requestCacheRef.current.clear();
          if (actionRef.current) {
            await actionRef.current.reload();
          }
        }}
        values={editingVariantGroup}
      />
      <ASINForm
        modalVisible={asinModalVisible}
        onCancel={() => {
          setAsinModalVisible(false);
          setEditingASIN(undefined);
          setSelectedVariantGroupId(undefined);
          setSelectedVariantGroupCountry(undefined);
        }}
        onSubmit={async () => {
          setAsinModalVisible(false);
          setEditingASIN(undefined);
          setSelectedVariantGroupId(undefined);
          setSelectedVariantGroupCountry(undefined);
          // 确保表格刷新
          requestCacheRef.current.clear();
          if (actionRef.current) {
            await actionRef.current.reload();
          }
        }}
        values={editingASIN}
        variantGroupId={selectedVariantGroupId}
        variantGroupCountry={selectedVariantGroupCountry}
      />
      <MoveASINModal
        visible={moveModalVisible}
        asinId={movingASIN?.id}
        currentGroupId={movingASIN?.parentId}
        onCancel={() => {
          setMoveModalVisible(false);
          setMovingASIN(undefined);
        }}
        onSuccess={async () => {
          setMoveModalVisible(false);
          setMovingASIN(undefined);
          requestCacheRef.current.clear();
          if (actionRef.current) {
            await actionRef.current.reload();
          }
        }}
      />
      <ExcelImportModal
        visible={excelImportModalVisible}
        onCancel={() => {
          setExcelImportModalVisible(false);
        }}
        onSuccess={async () => {
          setExcelImportModalVisible(false);
          requestCacheRef.current.clear();
          if (actionRef.current) {
            await actionRef.current.reload();
          }
        }}
      />
    </PageContainer>
  );
};

export default ASINManagement;
