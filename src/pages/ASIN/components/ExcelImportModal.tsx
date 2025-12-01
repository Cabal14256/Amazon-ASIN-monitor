import services from '@/services/asin';
import { useMessage } from '@/utils/message';
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import type { UploadFile, UploadProps } from 'antd';
import { Alert, Button, Modal, Progress, Table, Upload } from 'antd';
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

const ExcelImportModal: React.FC<ExcelImportModalProps> = (props) => {
  const { visible, open, onCancel, onSuccess } = props;
  const message = useMessage();
  const modalVisible = open !== undefined ? open : visible;
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [progress, setProgress] = useState(0);

  const handleUpload: UploadProps['customRequest'] = async (options) => {
    const { file, onSuccess: onUploadSuccess, onError } = options;
    setUploading(true);
    setProgress(0);
    setImportResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file as RcFile);

      const result = await importFromExcel(formData, {
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percent = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total,
            );
            setProgress(percent);
          }
        },
      });

      if (result.success) {
        setImportResult(result.data);
        message.success('导入完成');
        onUploadSuccess?.(result);
        if (result.data.successCount > 0) {
          setTimeout(() => {
            onSuccess();
          }, 1500);
        }
      } else {
        message.error(result.errorMessage || '导入失败');
        onError?.(new Error(result.errorMessage || '导入失败'));
      }
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.errorMessage || error.message || '导入失败';
      console.error('导入错误详情:', error);
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
    onCancel();
  };

  const downloadTemplate = () => {
    // 创建模板数据（不包含ASIN名称列）
    const templateData = [
      ['变体组名称', '国家', '站点', '品牌', 'ASIN', 'ASIN类型'],
      ['iPhone 15 Pro 变体组', 'US', '12', 'Apple', 'B0CHX1W1XY', 'MAIN_LINK'],
      ['iPhone 15 Pro 变体组', 'US', '12', 'Apple', 'B0CHX1W2XY', 'MAIN_LINK'],
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
              <p>7. ASIN类型：MAIN_LINK（主链）或 SUB_REVIEW（副评），可选</p>
              <p>8. 注意：ASIN不需要名称，系统会自动使用ASIN编码作为名称</p>
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
