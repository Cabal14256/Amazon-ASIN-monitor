import variantCheckServices from '@/services/variantCheck';
import { exportToExcel } from '@/utils/export';
import { useMessage } from '@/utils/message';
import {
  PageContainer,
  ProColumns,
  ProTable,
} from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import { Button, Card, Input, Select, Space, Tag } from 'antd';
import React, { useState } from 'react';

const { batchQueryParentAsin } = variantCheckServices.VariantCheckController;

// 国家选项映射
const countryOptions = [
  { label: '美国', value: 'US' },
  { label: '英国', value: 'UK' },
  { label: '德国', value: 'DE' },
  { label: '法国', value: 'FR' },
  { label: '意大利', value: 'IT' },
  { label: '西班牙', value: 'ES' },
];

interface QueryResult {
  asin: string;
  hasParentAsin: boolean;
  parentAsin: string | null;
  title: string;
  brand: string | null;
  hasVariants: boolean;
  variantCount: number;
  error: string | null;
}

const ASINParentQuery: React.FC<unknown> = () => {
  const message = useMessage();
  const access = useAccess();
  const [asinInput, setAsinInput] = useState<string>('');
  const [country, setCountry] = useState<string>('US');
  const [queryResults, setQueryResults] = useState<QueryResult[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  // 解析ASIN输入（支持逗号分隔或换行分隔）
  const parseAsinList = (input: string): string[] => {
    return input
      .split(/[,\n]/)
      .map((asin) => asin.trim().toUpperCase())
      .filter((asin) => asin && /^[A-Z][A-Z0-9]{9}$/.test(asin));
  };

  // 执行查询
  const handleQuery = async () => {
    if (!asinInput.trim()) {
      message.warning('请输入ASIN');
      return;
    }

    const asinList = parseAsinList(asinInput);
    if (asinList.length === 0) {
      message.warning('没有有效的ASIN，请检查输入格式');
      return;
    }

    if (!country) {
      message.warning('请选择国家');
      return;
    }

    setLoading(true);
    try {
      const response = await batchQueryParentAsin({
        asins: asinList,
        country,
      });

      if (response.success && Array.isArray(response.data)) {
        setQueryResults(response.data);
        const successCount = response.data.filter((r) => !r.error).length;
        const failCount = response.data.filter((r) => r.error).length;
        message.success(
          `查询完成：成功 ${successCount} 个，失败 ${failCount} 个`,
        );
      } else {
        message.error('查询失败，请重试');
        setQueryResults([]);
      }
    } catch (error: any) {
      console.error('查询失败:', error);
      message.error(error?.message || '查询失败，请重试');
      setQueryResults([]);
    } finally {
      setLoading(false);
    }
  };

  // 导出到Excel
  const handleExport = async () => {
    if (queryResults.length === 0) {
      message.warning('没有可导出的数据');
      return;
    }

    const asinList = queryResults.map((r) => r.asin).join(',');
    try {
      await exportToExcel(
        '/api/v1/export/parent-asin-query',
        {
          asins: asinList,
          country,
        },
        'ASIN父变体查询结果',
      );
    } catch (error: any) {
      console.error('导出失败:', error);
      message.error(error?.message || '导出失败，请重试');
    }
  };

  // 清空结果
  const handleClear = () => {
    setQueryResults([]);
    setAsinInput('');
    message.success('已清空');
  };

  // 表格列定义
  const columns: ProColumns<QueryResult>[] = [
    {
      title: 'ASIN',
      dataIndex: 'asin',
      width: 120,
      fixed: 'left',
      render: (text) => <Tag color="blue">{text}</Tag>,
    },
    {
      title: '是否有父变体',
      dataIndex: 'hasParentAsin',
      width: 120,
      render: (_, record) => (
        <Tag color={record.hasParentAsin ? 'green' : 'default'}>
          {record.hasParentAsin ? '是' : '否'}
        </Tag>
      ),
    },
    {
      title: '父变体ASIN',
      dataIndex: 'parentAsin',
      width: 120,
      render: (text) => (text ? <Tag color="orange">{text}</Tag> : '-'),
    },
    {
      title: '产品标题',
      dataIndex: 'title',
      ellipsis: true,
      width: 300,
    },
    {
      title: '品牌',
      dataIndex: 'brand',
      width: 120,
      render: (text) => text || '-',
    },
    {
      title: '是否有变体',
      dataIndex: 'hasVariants',
      width: 120,
      render: (_, record) => (
        <Tag color={record.hasVariants ? 'cyan' : 'default'}>
          {record.hasVariants ? '是' : '否'}
        </Tag>
      ),
    },
    {
      title: '变体数量',
      dataIndex: 'variantCount',
      width: 100,
      sorter: (a, b) => (a.variantCount || 0) - (b.variantCount || 0),
    },
    {
      title: '查询状态',
      dataIndex: 'error',
      width: 150,
      render: (text) =>
        text ? (
          <Tag color="red" title={text}>
            失败
          </Tag>
        ) : (
          <Tag color="success">成功</Tag>
        ),
    },
    {
      title: '错误信息',
      dataIndex: 'error',
      ellipsis: true,
      hideInTable: false,
      render: (text) => text || '-',
    },
  ];

  return (
    <PageContainer
      header={{
        title: 'ASIN父变体查询',
        breadcrumb: {},
      }}
    >
      <Card
        title="查询条件"
        style={{ marginBottom: 16 }}
        extra={
          <Space>
            <Button onClick={handleClear}>清空</Button>
            <Button
              type="primary"
              onClick={handleQuery}
              loading={loading}
              disabled={!access.canReadASIN}
            >
              查询
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <div>
            <div style={{ marginBottom: 8 }}>
              <strong>ASIN列表</strong>（每行一个或逗号分隔）
            </div>
            <Input.TextArea
              rows={6}
              placeholder="请输入ASIN，每行一个或使用逗号分隔&#10;例如：&#10;B08XYZ1234&#10;B09ABC5678&#10;或：B08XYZ1234,B09ABC5678"
              value={asinInput}
              onChange={(e) => setAsinInput(e.target.value)}
              disabled={!access.canReadASIN}
            />
            <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
              已输入 {parseAsinList(asinInput).length} 个有效ASIN
            </div>
          </div>
          <div>
            <div style={{ marginBottom: 8 }}>
              <strong>国家/站点</strong>
            </div>
            <Select
              style={{ width: 200 }}
              value={country}
              onChange={setCountry}
              options={countryOptions}
              disabled={!access.canReadASIN}
            />
          </div>
        </Space>
      </Card>

      {queryResults.length > 0 && (
        <Card
          title={`查询结果 (共 ${queryResults.length} 条)`}
          extra={
            <Button
              type="primary"
              onClick={handleExport}
              disabled={!access.canReadASIN}
            >
              导出到Excel
            </Button>
          }
        >
          <ProTable<QueryResult>
            columns={columns}
            dataSource={queryResults}
            rowKey="asin"
            search={false}
            pagination={{
              defaultPageSize: 20,
              showSizeChanger: true,
              showQuickJumper: true,
              showTotal: (total) => `共 ${total} 条`,
              pageSizeOptions: ['10', '20', '50', '100'],
            }}
            scroll={{ x: 1200 }}
            size="small"
          />
        </Card>
      )}
    </PageContainer>
  );
};

export default ASINParentQuery;
