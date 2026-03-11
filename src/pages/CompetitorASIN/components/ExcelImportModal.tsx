import services from '@/services/competitor';
import { debugError } from '@/utils/debug';
import { useMessage } from '@/utils/message';
import {
  extractAsyncTask,
  extractImportResult,
  openTaskCenter,
  waitForTaskResult,
} from '@/utils/task';
import {
  DeleteOutlined,
  DownloadOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import type { TableColumnsType, UploadFile, UploadProps } from 'antd';
import {
  Alert,
  Button,
  Input,
  Modal,
  Progress,
  Select,
  Space,
  Table,
  Tabs,
  Upload,
} from 'antd';
import type { RcFile } from 'antd/es/upload';
import React, { useEffect, useRef, useState } from 'react';
import './ExcelImportModal.less';

const { importCompetitorFromExcel } = services.CompetitorASINController;

interface ExcelImportModalProps {
  visible?: boolean;
  open?: boolean;
  onCancel: () => void;
  onSuccess: () => void;
}

interface ImportResult {
  success: boolean;
  total: number;
  processedCount?: number;
  successCount: number;
  failedCount: number;
  missingCount?: number;
  verificationPassed?: boolean;
  errors?: Array<{ row: number; message: string }>;
}

interface CreatedTask {
  taskId: string;
  status?: string | null;
}

interface OnlineImportRow {
  id: string;
  groupName: string;
  country: string;
  brand: string;
  asin: string;
  asinType: string;
}

const ONLINE_FIELDS = [
  'groupName',
  'country',
  'brand',
  'asin',
  'asinType',
] as const;
const DEFAULT_ONLINE_ROW_COUNT = 12;

type OnlineField = (typeof ONLINE_FIELDS)[number];

type ActiveCell = {
  rowId: string;
  field: OnlineField;
};

const EMPTY_ROW = (): OnlineImportRow => ({
  id: `${Date.now()}-${Math.random()}`,
  groupName: '',
  country: '',
  brand: '',
  asin: '',
  asinType: '',
});

const createInitialRows = () =>
  Array.from({ length: DEFAULT_ONLINE_ROW_COUNT }, () => EMPTY_ROW());

const ExcelImportModal: React.FC<ExcelImportModalProps> = (props) => {
  const { visible, open, onCancel, onSuccess } = props;
  const message = useMessage();
  const modalVisible = open !== undefined ? open : visible;
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [createdTask, setCreatedTask] = useState<CreatedTask | null>(null);
  const [progress, setProgress] = useState(0);
  const [taskMessage, setTaskMessage] = useState('');
  const [onlineRows, setOnlineRows] =
    useState<OnlineImportRow[]>(createInitialRows);
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const resetImportState = () => {
    setFileList([]);
    setImportResult(null);
    setCreatedTask(null);
    setProgress(0);
    setTaskMessage('');
    setOnlineRows(createInitialRows());
    setActiveCell(null);
  };

  const submitImport = async (file: RcFile | File) => {
    setUploading(true);
    setProgress(0);
    setImportResult(null);
    setCreatedTask(null);
    setTaskMessage('');

    const formData = new FormData();
    formData.append('file', file);

    const result = await importCompetitorFromExcel(formData, {
      onUploadProgress: (progressEvent: any) => {
        if (mountedRef.current && progressEvent.total) {
          const percent = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total,
          );
          setProgress(percent);
        }
      },
    });

    const task = extractAsyncTask(result);
    if (result.success && task) {
      if (mountedRef.current) {
        setCreatedTask(task);
        setProgress(5);
        setTaskMessage('导入任务已创建，等待后台处理');
      }
      message.success('导入任务已创建，正在后台处理');

      const completedTask = await waitForTaskResult(task.taskId, {
        timeoutMs: 30 * 60 * 1000,
        onProgress: (taskStatus) => {
          if (!mountedRef.current) {
            return;
          }

          const nextProgress =
            typeof taskStatus.progress === 'number'
              ? Math.max(0, Math.min(100, taskStatus.progress))
              : 0;
          setCreatedTask({
            taskId: task.taskId,
            status: taskStatus.status,
          });
          setProgress(nextProgress > 0 ? nextProgress : 5);
          setTaskMessage(
            taskStatus.message ||
              (taskStatus.status === 'pending'
                ? '任务已入队，等待 worker 处理...'
                : `正在导入... (${nextProgress}%)`),
          );
        },
      });

      const normalizedResult = extractImportResult(completedTask);
      if (!normalizedResult) {
        throw new Error('导入任务已完成，但未返回结果');
      }

      const importData: ImportResult = {
        success:
          normalizedResult.failedCount === 0 &&
          normalizedResult.missingCount === 0,
        total: normalizedResult.total,
        processedCount: normalizedResult.processedCount,
        successCount: normalizedResult.successCount,
        failedCount: normalizedResult.failedCount,
        missingCount: normalizedResult.missingCount,
        verificationPassed: normalizedResult.verificationPassed,
        errors: normalizedResult.errors?.map((error) => ({
          row: typeof error.row === 'number' ? error.row : 0,
          message: error.message,
        })),
      };

      if (mountedRef.current) {
        setCreatedTask({
          taskId: task.taskId,
          status: completedTask.status,
        });
        setProgress(100);
        setTaskMessage(
          importData.verificationPassed
            ? '导入完成，结果已校验'
            : `导入完成，但仍有 ${importData.missingCount || 0} 条记录需要核对`,
        );
        setImportResult(importData);
      }

      if (importData.successCount > 0) {
        await Promise.resolve(onSuccess());
      }

      const summary = `导入完成：总计 ${importData.total} 条，成功 ${importData.successCount} 条，失败 ${importData.failedCount} 条`;
      if (importData.failedCount > 0 || (importData.missingCount || 0) > 0) {
        message.warning(summary);
      } else {
        message.success(summary);
      }
      return;
    }

    if (result.success && result.data) {
      const rawData = result.data as Record<string, any>;
      const normalizedResult = extractImportResult(result.data);
      const importData: ImportResult = normalizedResult
        ? {
            success:
              normalizedResult.failedCount === 0 &&
              normalizedResult.missingCount === 0,
            total: normalizedResult.total,
            processedCount: normalizedResult.processedCount,
            successCount: normalizedResult.successCount,
            failedCount: normalizedResult.failedCount,
            missingCount: normalizedResult.missingCount,
            verificationPassed: normalizedResult.verificationPassed,
            errors: normalizedResult.errors?.map((error) => ({
              row: typeof error.row === 'number' ? error.row : 0,
              message: error.message,
            })),
          }
        : {
            success: true,
            total: rawData.total || 0,
            processedCount: rawData.processedCount || 0,
            successCount: rawData.successCount || 0,
            failedCount: rawData.failedCount || 0,
            missingCount: rawData.missingCount || 0,
            verificationPassed: rawData.verificationPassed !== false,
            errors: rawData.errors,
          };
      setImportResult(importData);
      setTaskMessage(
        importData.verificationPassed
          ? '导入完成，结果已校验'
          : `导入完成，但仍有 ${importData.missingCount || 0} 条记录需要核对`,
      );
      message.success('导入完成');
      if (importData.successCount > 0) {
        await Promise.resolve(onSuccess());
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
      setTaskMessage(errorMessage);
      message.error(errorMessage);
      if (error.response?.data?.data) {
        const normalizedResult = extractImportResult(error.response.data.data);
        setImportResult(
          normalizedResult
            ? {
                success:
                  normalizedResult.failedCount === 0 &&
                  normalizedResult.missingCount === 0,
                total: normalizedResult.total,
                processedCount: normalizedResult.processedCount,
                successCount: normalizedResult.successCount,
                failedCount: normalizedResult.failedCount,
                missingCount: normalizedResult.missingCount,
                verificationPassed: normalizedResult.verificationPassed,
                errors: normalizedResult.errors?.map((item) => ({
                  row: typeof item.row === 'number' ? item.row : 0,
                  message: item.message,
                })),
              }
            : error.response.data.data,
        );
      }
      onError?.(error);
    } finally {
      setUploading(false);
    }
  };

  const updateOnlineCell = (
    rowId: string,
    field: OnlineField,
    value: string,
  ) => {
    setOnlineRows((prev) =>
      prev.map((row) => (row.id === rowId ? { ...row, [field]: value } : row)),
    );
  };

  const appendOnlineRows = (count: number) => {
    const safeCount = Math.max(1, count);
    setOnlineRows((prev) => [
      ...prev,
      ...Array.from({ length: safeCount }, () => EMPTY_ROW()),
    ]);
  };

  const removeLastRow = () => {
    setOnlineRows((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  };

  const handleOnlineSheetPaste = (
    event: React.ClipboardEvent<HTMLDivElement>,
  ) => {
    if (!activeCell) {
      return;
    }

    const clipboardText = event.clipboardData.getData('text/plain');
    if (
      !clipboardText ||
      (!clipboardText.includes('\n') && !clipboardText.includes('\t'))
    ) {
      return;
    }

    const matrix = clipboardText
      .replace(/\r/g, '')
      .split('\n')
      .filter(
        (line, index, arr) => !(index === arr.length - 1 && line.trim() === ''),
      )
      .map((line) => line.split('\t'));

    if (matrix.length === 0) {
      return;
    }

    event.preventDefault();

    setOnlineRows((prev) => {
      const rowIndex = prev.findIndex((row) => row.id === activeCell.rowId);
      const fieldIndex = ONLINE_FIELDS.indexOf(activeCell.field);

      if (rowIndex < 0 || fieldIndex < 0) {
        return prev;
      }

      const requiredRows = rowIndex + matrix.length;
      const nextRows = [...prev];
      while (nextRows.length < requiredRows) {
        nextRows.push(EMPTY_ROW());
      }

      matrix.forEach((cells, rowOffset) => {
        const targetIndex = rowIndex + rowOffset;
        const targetRow = { ...nextRows[targetIndex] };
        cells.forEach((cellValue, cellOffset) => {
          const targetField = ONLINE_FIELDS[fieldIndex + cellOffset];
          if (targetField) {
            targetRow[targetField] = cellValue.trim();
          }
        });
        nextRows[targetIndex] = targetRow;
      });

      return nextRows;
    });
  };

  const handleCancel = () => {
    onCancel();
  };

  const handleOnlineImport = async () => {
    const validRows = onlineRows.filter(
      (row) =>
        row.groupName.trim() ||
        row.country.trim() ||
        row.brand.trim() ||
        row.asin.trim(),
    );

    if (validRows.length === 0) {
      message.warning('请至少填写一行数据');
      return;
    }

    const requiredFieldNames = {
      groupName: '变体组名称',
      country: '国家',
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

    const header = ['变体组名称', '国家', '品牌', 'ASIN', 'ASIN类型'];
    const escapeCsvValue = (value?: string) => {
      const normalized = (value || '').trim();
      return `"${normalized.replace(/"/g, '""')}"`;
    };
    const csvLines = [
      header.join(','),
      ...validRows.map((row) =>
        [row.groupName, row.country, row.brand, row.asin, row.asinType]
          .map((value) => escapeCsvValue(value))
          .join(','),
      ),
    ];

    try {
      const csvBlob = new Blob(['\ufeff' + csvLines.join('\n')], {
        type: 'text/csv;charset=utf-8;',
      });
      const csvFile = new File([csvBlob], 'online-competitor-import.csv', {
        type: 'text/csv;charset=utf-8;',
      });
      await submitImport(csvFile);
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.errorMessage || error.message || '导入失败';
      debugError('在线导入错误详情:', error);
      setTaskMessage(errorMessage);
      message.error(errorMessage);
      if (error.response?.data?.data) {
        const normalizedResult = extractImportResult(error.response.data.data);
        setImportResult(
          normalizedResult
            ? {
                success:
                  normalizedResult.failedCount === 0 &&
                  normalizedResult.missingCount === 0,
                total: normalizedResult.total,
                processedCount: normalizedResult.processedCount,
                successCount: normalizedResult.successCount,
                failedCount: normalizedResult.failedCount,
                missingCount: normalizedResult.missingCount,
                verificationPassed: normalizedResult.verificationPassed,
                errors: normalizedResult.errors?.map((item) => ({
                  row: typeof item.row === 'number' ? item.row : 0,
                  message: item.message,
                })),
              }
            : error.response.data.data,
        );
      }
    } finally {
      setUploading(false);
    }
  };

  const renderRequiredTitle = (title: string) => (
    <span>
      {title}
      <span style={{ color: '#ff4d4f', marginLeft: 4 }}>*</span>
    </span>
  );

  const onlineColumns: TableColumnsType<OnlineImportRow> = [
    {
      title: '#',
      dataIndex: 'rowNo',
      width: 52,
      fixed: 'left',
      className: 'row-index-cell',
      render: (_, __, index) => index + 1,
    },
    {
      title: renderRequiredTitle('变体组名称'),
      dataIndex: 'groupName',
      width: 220,
      render: (_, record) => (
        <Input
          className="online-cell-input"
          value={record.groupName}
          placeholder="如：iPhone 15 Pro 变体组"
          onFocus={() =>
            setActiveCell({ rowId: record.id, field: 'groupName' })
          }
          onChange={(event) =>
            updateOnlineCell(record.id, 'groupName', event.target.value)
          }
        />
      ),
    },
    {
      title: renderRequiredTitle('国家'),
      dataIndex: 'country',
      width: 140,
      render: (_, record) => (
        <Input
          className="online-cell-input"
          value={record.country}
          placeholder="US"
          onFocus={() => setActiveCell({ rowId: record.id, field: 'country' })}
          onChange={(event) =>
            updateOnlineCell(record.id, 'country', event.target.value)
          }
        />
      ),
    },
    {
      title: renderRequiredTitle('品牌'),
      dataIndex: 'brand',
      width: 200,
      render: (_, record) => (
        <Input
          className="online-cell-input"
          value={record.brand}
          placeholder="品牌名称"
          onFocus={() => setActiveCell({ rowId: record.id, field: 'brand' })}
          onChange={(event) =>
            updateOnlineCell(record.id, 'brand', event.target.value)
          }
        />
      ),
    },
    {
      title: renderRequiredTitle('ASIN'),
      dataIndex: 'asin',
      width: 200,
      render: (_, record) => (
        <Input
          className="online-cell-input"
          value={record.asin}
          placeholder="B0XXXXXXXX"
          onFocus={() => setActiveCell({ rowId: record.id, field: 'asin' })}
          onChange={(event) =>
            updateOnlineCell(record.id, 'asin', event.target.value)
          }
        />
      ),
    },
    {
      title: 'ASIN类型',
      dataIndex: 'asinType',
      width: 140,
      render: (_, record) => (
        <Select
          className="online-cell-select"
          value={record.asinType || undefined}
          placeholder="可选"
          options={[
            { value: '1', label: '1 主链' },
            { value: '2', label: '2 副评' },
          ]}
          onFocus={() => setActiveCell({ rowId: record.id, field: 'asinType' })}
          onChange={(value) =>
            updateOnlineCell(record.id, 'asinType', value || '')
          }
          allowClear
          style={{ width: '100%' }}
        />
      ),
    },
  ];

  const downloadTemplate = () => {
    const templateData = [
      ['变体组名称', '国家', '品牌', 'ASIN', 'ASIN类型'],
      ['iPhone 15 Pro 变体组', 'US', 'Apple', 'B0CHX1W1XY', '1'],
      ['iPhone 15 Pro 变体组', 'US', 'Apple', 'B0CHX1W2XY', '1'],
      ['MacBook Pro 变体组', 'UK', 'Apple', 'B09JQL8KP9', ''],
    ];

    const csvContent = templateData.map((row) => row.join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csvContent], {
      type: 'text/csv;charset=utf-8;',
    });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', '竞品ASIN导入模板.csv');
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
      title="Excel导入竞品变体组"
      open={modalVisible}
      onCancel={handleCancel}
      footer={null}
      width={960}
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
                          Excel文件格式：第一行为表头，包含：变体组名称（必填）、国家（必填）、品牌（必填）、ASIN（必填）、ASIN类型（可选）
                        </p>
                        <p>2. 相同变体组名称的行会被归为一个变体组</p>
                        <p>3. 支持的文件格式：.xlsx, .xls, .csv</p>
                        <p>4. 国家代码：US, UK, DE, FR, IT, ES</p>
                        <p>5. 品牌：产品品牌名称（必填）</p>
                        <p>6. ASIN类型：1（主链）或 2（副评），可选</p>
                        <p>
                          7.
                          注意：ASIN不需要名称，系统会自动使用ASIN编码作为名称
                        </p>
                        <p>8. 竞品监控不需要站点字段</p>
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
                    {uploading
                      ? createdTask
                        ? '后台处理中...'
                        : '上传中...'
                      : '选择文件'}
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
                  description="表格支持单元格直接编辑；可从 Excel 复制多行多列后，选中起始单元格直接粘贴。"
                  type="info"
                  showIcon
                  style={{ marginBottom: 12 }}
                />
                <div
                  className="online-import-sheet"
                  onPaste={handleOnlineSheetPaste}
                >
                  <Table<OnlineImportRow>
                    rowKey="id"
                    columns={onlineColumns}
                    dataSource={onlineRows}
                    pagination={false}
                    size="small"
                    bordered
                    sticky
                    scroll={{ x: 840, y: 360 }}
                  />
                </div>
                <Space wrap>
                  <Button
                    icon={<PlusOutlined />}
                    onClick={() => appendOnlineRows(5)}
                    disabled={uploading}
                  >
                    新增5行
                  </Button>
                  <Button
                    icon={<DeleteOutlined />}
                    onClick={removeLastRow}
                    disabled={uploading || onlineRows.length <= 1}
                  >
                    删除末行
                  </Button>
                  <Button
                    onClick={() => {
                      setOnlineRows(createInitialRows());
                      setActiveCell(null);
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
          {taskMessage ? (
            <div style={{ marginTop: 8, color: '#8c8c8c' }}>{taskMessage}</div>
          ) : null}
        </div>
      )}

      {createdTask && (
        <div style={{ marginTop: 24 }}>
          <Alert
            message={
              createdTask.status === 'completed'
                ? '导入任务已完成'
                : createdTask.status === 'failed'
                ? '导入任务失败'
                : createdTask.status === 'cancelled'
                ? '导入任务已取消'
                : '导入任务正在后台执行'
            }
            description={`任务ID：${createdTask.taskId}。${
              taskMessage ||
              '页面关闭或刷新不会中断任务，可在任务中心查看进度或取消任务。'
            }`}
            type={
              createdTask.status === 'failed'
                ? 'error'
                : createdTask.status === 'cancelled'
                ? 'warning'
                : createdTask.status === 'completed'
                ? 'success'
                : 'info'
            }
            showIcon
            action={
              <Button type="link" size="small" onClick={openTaskCenter}>
                任务中心
              </Button>
            }
          />
        </div>
      )}

      {importResult && (
        <div style={{ marginTop: 24 }}>
          <Alert
            message={`导入完成：总计 ${importResult.total} 条，成功 ${importResult.successCount} 条，失败 ${importResult.failedCount} 条`}
            description={
              importResult.verificationPassed !== false
                ? '后台结果已校验：成功数 + 失败数与总计一致。'
                : `后台结果校验未通过：仍有 ${
                    importResult.missingCount || 0
                  } 条记录未归类，请重点检查错误详情。`
            }
            type={
              importResult.failedCount === 0 &&
              (importResult.missingCount || 0) === 0 &&
              importResult.verificationPassed !== false
                ? 'success'
                : 'warning'
            }
            showIcon
            style={{ marginBottom: 16 }}
            action={
              <Space size={4}>
                <Button
                  type="link"
                  size="small"
                  onClick={() => void onSuccess()}
                >
                  刷新列表
                </Button>
                <Button type="link" size="small" onClick={resetImportState}>
                  继续导入
                </Button>
              </Space>
            }
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
