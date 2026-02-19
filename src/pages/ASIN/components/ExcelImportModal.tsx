import services from '@/services/asin';
import { debugError } from '@/utils/debug';
import { useMessage } from '@/utils/message';
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import type { ProColumns } from '@ant-design/pro-components';
import { EditableProTable } from '@ant-design/pro-components';
import type { UploadFile, UploadProps } from 'antd';
import {
  Alert,
  Button,
  Modal,
  Progress,
  Space,
  Table,
  Tabs,
  Upload,
} from 'antd';
import type { RcFile } from 'antd/es/upload';
import React, { useState } from 'react';

const { importFromExcel } = services.ASINController;

interface ExcelImportModalProps {
  visible?: boolean;
  open?: boolean;
  onCancel: () => void;
  onSuccess: () => void;
}

interface ImportResult {
  success: boolean;
  total: number;
  successCount: number;
  failedCount: number;
  errors?: Array<{ row: number; message: string }>;
}

interface OnlineImportRow {
  id: string;
  groupName?: string;
  country?: string;
  site?: string;
  brand?: string;
  asin?: string;
  asinType?: string;
}

const EMPTY_ROW = (): OnlineImportRow => ({
  id: `${Date.now()}-${Math.random()}`,
});

const ExcelImportModal: React.FC<ExcelImportModalProps> = (props) => {
  const { visible, open, onCancel, onSuccess } = props;
  const message = useMessage();
  const modalVisible = open !== undefined ? open : visible;
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [onlineRows, setOnlineRows] = useState<OnlineImportRow[]>([
    EMPTY_ROW(),
  ]);
  const [editableRowKeys, setEditableRowKeys] = useState<React.Key[]>([]);

  const submitImport = async (file: RcFile | File) => {
    setUploading(true);
    setProgress(0);
    setImportResult(null);

    const formData = new FormData();
    formData.append('file', file);

    const result = await importFromExcel(formData, {
      onUploadProgress: (progressEvent: any) => {
        if (progressEvent.total) {
          const percent = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total,
          );
          setProgress(percent);
        }
      },
    });

    if (result.success && result.data) {
      const importData: ImportResult = {
        success: true,
        total: result.data.total || 0,
        successCount: result.data.successCount || 0,
        failedCount: result.data.failedCount || 0,
        errors: result.data.errors,
      };
      setImportResult(importData);
      message.success('导入完成');
      if (importData.successCount > 0) {
        setTimeout(() => {
          onSuccess();
        }, 1500);
      }
      return;
    }

    throw new Error(result.errorMessage || '导入失败');
  };

  const handleUpload: UploadProps['customRequest'] = async (options) => {
    const { file, onSuccess: onUploadSuccess, onError } = options;
    setUploading(true);

    try {
      await submitImport(file as RcFile);
      onUploadSuccess?.({});
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.errorMessage || error.message || '导入失败';
      debugError('导入错误详情:', error);
      message.error(errorMessage);
      // 如果有错误响应数据，也设置到结果中
      if (error.response?.data?.data) {
        setImportResult(error.response.data.data);
      }
      onError?.(error);
    } finally {
      setUploading(false);
    }
  };

  const handleCancel = () => {
    setFileList([]);
    setImportResult(null);
    setProgress(0);
    setOnlineRows([EMPTY_ROW()]);
    setEditableRowKeys([]);
    onCancel();
  };

  const handleOnlineImport = async () => {
    const validRows = onlineRows.filter(
      (row) =>
        row.groupName || row.country || row.site || row.brand || row.asin,
    );

    if (validRows.length === 0) {
      message.warning('请至少填写一行数据');
      return;
    }

    const requiredFieldNames = {
      groupName: '变体组名称',
      country: '国家',
      site: '站点',
      brand: '品牌',
      asin: 'ASIN',
    };

    for (let index = 0; index < validRows.length; index += 1) {
      const row = validRows[index];
      const requiredFields = Object.keys(requiredFieldNames) as Array<
        keyof typeof requiredFieldNames
      >;
      for (const field of requiredFields) {
        if (!row[field]?.trim()) {
          message.error(
            `第 ${index + 1} 行缺少${
              requiredFieldNames[field]
            }，请补充后再导入`,
          );
          return;
        }
      }
    }

    const header = ['变体组名称', '国家', '站点', '品牌', 'ASIN', 'ASIN类型'];
    const escapeCsvValue = (value?: string) => {
      const normalized = (value || '').trim();
      return `"${normalized.replace(/"/g, '""')}"`;
    };
    const csvLines = [
      header.join(','),
      ...validRows.map((row) =>
        [
          row.groupName,
          row.country,
          row.site,
          row.brand,
          row.asin,
          row.asinType,
        ]
          .map((value) => escapeCsvValue(value))
          .join(','),
      ),
    ];

    try {
      const csvBlob = new Blob(['\ufeff' + csvLines.join('\n')], {
        type: 'text/csv;charset=utf-8;',
      });
      const csvFile = new File([csvBlob], 'online-import.csv', {
        type: 'text/csv;charset=utf-8;',
      });
      await submitImport(csvFile);
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.errorMessage || error.message || '导入失败';
      debugError('在线导入错误详情:', error);
      message.error(errorMessage);
      if (error.response?.data?.data) {
        setImportResult(error.response.data.data);
      }
    } finally {
      setUploading(false);
    }
  };

  const onlineColumns: ProColumns<OnlineImportRow>[] = [
    {
      title: '变体组名称',
      dataIndex: 'groupName',
      width: 180,
      formItemProps: { required: true },
    },
    {
      title: '国家',
      dataIndex: 'country',
      width: 90,
      formItemProps: { required: true },
    },
    {
      title: '站点',
      dataIndex: 'site',
      width: 90,
      formItemProps: { required: true },
    },
    {
      title: '品牌',
      dataIndex: 'brand',
      width: 130,
      formItemProps: { required: true },
    },
    {
      title: 'ASIN',
      dataIndex: 'asin',
      width: 140,
      formItemProps: { required: true },
    },
    { title: 'ASIN类型', dataIndex: 'asinType', width: 110 },
  ];

  const downloadTemplate = () => {
    // 创建模板数据（不包含ASIN名称列）
    const templateData = [
      ['变体组名称', '国家', '站点', '品牌', 'ASIN', 'ASIN类型'],
      ['iPhone 15 Pro 变体组', 'US', '12', 'Apple', 'B0CHX1W1XY', '1'],
      ['iPhone 15 Pro 变体组', 'US', '12', 'Apple', 'B0CHX1W2XY', '1'],
      ['MacBook Pro 变体组', 'UK', '15', 'Apple', 'B09JQL8KP9', ''],
    ];

    // 转换为CSV格式
    const csvContent = templateData.map((row) => row.join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csvContent], {
      type: 'text/csv;charset=utf-8;',
    });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'ASIN导入模板.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const errorColumns = [
    {
      title: '行号',
      dataIndex: 'row',
      key: 'row',
      width: 80,
    },
    {
      title: '错误信息',
      dataIndex: 'message',
      key: 'message',
    },
  ];

  return (
    <Modal
      title="Excel导入变体组"
      open={modalVisible}
      onCancel={handleCancel}
      footer={null}
      width={700}
    >
      <Tabs
        items={[
          {
            key: 'excel',
            label: 'Excel导入',
            children: (
              <>
                <div style={{ marginBottom: 16 }}>
                  <Alert
                    message="导入说明"
                    description={
                      <div>
                        <p>
                          1.
                          Excel文件格式：第一行为表头，包含：变体组名称（必填）、国家（必填）、站点（必填）、品牌（必填）、ASIN（必填）、ASIN类型（可选）
                        </p>
                        <p>2. 相同变体组名称的行会被归为一个变体组</p>
                        <p>3. 支持的文件格式：.xlsx, .xls, .csv</p>
                        <p>4. 国家代码：US, UK, DE, FR, IT, ES</p>
                        <p>5. 站点：内部店铺代号（如：12）</p>
                        <p>6. 品牌：产品品牌名称（必填）</p>
                        <p>7. ASIN类型：1（主链）或 2（副评），可选</p>
                        <p>
                          8.
                          注意：ASIN不需要名称，系统会自动使用ASIN编码作为名称
                        </p>
                      </div>
                    }
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                  <Button
                    icon={<DownloadOutlined />}
                    onClick={downloadTemplate}
                    style={{ marginBottom: 16 }}
                  >
                    下载导入模板
                  </Button>
                </div>

                <Upload
                  fileList={fileList}
                  onChange={({ fileList: newFileList }) => {
                    setFileList(newFileList);
                  }}
                  customRequest={handleUpload}
                  accept=".xlsx,.xls,.csv"
                  maxCount={1}
                  disabled={uploading}
                >
                  <Button
                    icon={<UploadOutlined />}
                    loading={uploading}
                    disabled={uploading}
                  >
                    {uploading ? '上传中...' : '选择文件'}
                  </Button>
                </Upload>
              </>
            ),
          },
          {
            key: 'online',
            label: '在线表格录入',
            children: (
              <>
                <Alert
                  message="在线录入说明"
                  description="可直接在表格中录入多行数据后提交，系统会自动转为CSV并按Excel导入规则校验。"
                  type="info"
                  showIcon
                  style={{ marginBottom: 12 }}
                />
                <EditableProTable<OnlineImportRow>
                  rowKey="id"
                  columns={onlineColumns}
                  value={onlineRows}
                  onChange={(value) => setOnlineRows([...value])}
                  recordCreatorProps={false}
                  editable={{
                    type: 'multiple',
                    editableKeys: editableRowKeys,
                    onChange: setEditableRowKeys,
                  }}
                  scroll={{ x: 760 }}
                />
                <Space>
                  <Button
                    onClick={() => {
                      const newRow = EMPTY_ROW();
                      setOnlineRows((prev) => [...prev, newRow]);
                      setEditableRowKeys((prev) => [...prev, newRow.id]);
                    }}
                    disabled={uploading}
                  >
                    新增一行
                  </Button>
                  <Button
                    onClick={() => {
                      setOnlineRows([EMPTY_ROW()]);
                      setEditableRowKeys([]);
                    }}
                    disabled={uploading}
                  >
                    清空表格
                  </Button>
                  <Button
                    type="primary"
                    onClick={handleOnlineImport}
                    loading={uploading}
                  >
                    提交在线导入
                  </Button>
                </Space>
              </>
            ),
          },
        ]}
      />

      {uploading && progress > 0 && (
        <div style={{ marginTop: 16 }}>
          <Progress percent={progress} status="active" />
        </div>
      )}

      {importResult && (
        <div style={{ marginTop: 24 }}>
          <Alert
            message={`导入完成：成功 ${importResult.successCount} 条，失败 ${importResult.failedCount} 条`}
            type={importResult.failedCount === 0 ? 'success' : 'warning'}
            showIcon
            style={{ marginBottom: 16 }}
          />
          {importResult.errors && importResult.errors.length > 0 && (
            <div>
              <h4>错误详情：</h4>
              <Table
                columns={errorColumns}
                dataSource={importResult.errors.map((error, index) => ({
                  key: index,
                  ...error,
                }))}
                pagination={{ pageSize: 5 }}
                size="small"
              />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

export default ExcelImportModal;
