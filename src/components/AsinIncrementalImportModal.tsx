import type {
  ImportConfirmResponse,
  ImportPreviewPage,
  ImportPreviewResponse,
  ImportPreviewRow,
} from '@/services/asin/importTypes';
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
  Tag,
  Typography,
  Upload,
} from 'antd';
import React, { useEffect, useRef, useState } from 'react';

type OnlineField =
  | 'groupId'
  | 'groupName'
  | 'country'
  | 'site'
  | 'brand'
  | 'asin'
  | 'asinName'
  | 'asinType';

type OnlineRow = Record<OnlineField, string> & { id: string };

type ImportApi = {
  preview: (
    data: FormData,
    options?: { [key: string]: any },
  ) => Promise<ImportPreviewResponse>;
  getPreview: (
    previewId: string,
    params: { page: number; pageSize: number },
  ) => Promise<ImportPreviewResponse>;
  confirm: (previewId: string) => Promise<ImportConfirmResponse>;
};

export interface AsinIncrementalImportModalProps {
  visible?: boolean;
  open?: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  competitor: boolean;
  api: ImportApi;
}

const FIELD_LABELS: Record<OnlineField, string> = {
  groupId: '变体组ID',
  groupName: '变体组名称',
  country: '国家',
  site: '站点',
  brand: '品牌',
  asin: 'ASIN',
  asinName: 'ASIN名称',
  asinType: 'ASIN类型',
};

const VALUE_LABELS: Record<string, string> = {
  id: 'ID',
  groupId: '变体组ID',
  variantGroupId: '变体组ID',
  variant_group_id: '变体组ID',
  groupName: '变体组名称',
  variantGroupName: '变体组名称',
  name: '名称',
  country: '国家',
  site: '站点',
  brand: '品牌',
  asin: 'ASIN',
  asinName: 'ASIN名称',
  asinType: 'ASIN类型',
  asin_type: 'ASIN类型',
};

const PAGE_SIZE = 50;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const emptyRow = (): OnlineRow => ({
  id: `${Date.now()}-${Math.random()}`,
  groupId: '',
  groupName: '',
  country: '',
  site: '',
  brand: '',
  asin: '',
  asinName: '',
  asinType: '',
});

const initialRows = () => Array.from({ length: 12 }, emptyRow);

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number')
    return String(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  return JSON.stringify(value);
}

function displayRecord(value: unknown): React.ReactNode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return displayValue(value);
  }
  return (
    <Space direction="vertical" size={4}>
      {Object.entries(value).map(([key, entry]) => {
        if (key === 'group' || key === 'asin') {
          return (
            <div key={key}>
              <Typography.Text strong>
                {key === 'group' ? '变体组' : 'ASIN 记录'}：
              </Typography.Text>
              <div style={{ paddingLeft: 12 }}>
                {entry && typeof entry === 'object' && !Array.isArray(entry)
                  ? Object.entries(entry).map(([field, fieldValue]) => (
                      <div key={field}>
                        {VALUE_LABELS[field] || field}：
                        {displayValue(fieldValue)}
                      </div>
                    ))
                  : displayValue(entry)}
              </div>
            </div>
          );
        }
        return (
          <Typography.Text key={key} style={{ whiteSpace: 'normal' }}>
            {VALUE_LABELS[key] || key}：{displayValue(entry)}
          </Typography.Text>
        );
      })}
    </Space>
  );
}

function displayChanges(value: unknown): React.ReactNode {
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    return (
      <Space direction="vertical" size={0}>
        {value.map((entry, index) => {
          if (typeof entry !== 'object' || !entry)
            return <span key={index}>{displayValue(entry)}</span>;
          const item = entry as Record<string, unknown>;
          const field = String(item.field ?? item.key ?? index + 1);
          return (
            <span key={index}>
              {VALUE_LABELS[field] || field}：
              {displayValue(item.before ?? item.from)} →{' '}
              {displayValue(item.after ?? item.to)}
            </span>
          );
        })}
      </Space>
    );
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '—';
    return (
      <Space direction="vertical" size={0}>
        {entries.map(([field, entry]) => {
          if (Array.isArray(entry)) {
            return (
              <span key={field}>
                {VALUE_LABELS[field] || field}：{displayValue(entry[0])} →{' '}
                {displayValue(entry[1])}
              </span>
            );
          }
          if (entry && typeof entry === 'object') {
            const diff = entry as Record<string, unknown>;
            return (
              <span key={field}>
                {VALUE_LABELS[field] || field}：
                {displayValue(diff.before ?? diff.from)} →{' '}
                {displayValue(diff.after ?? diff.to)}
              </span>
            );
          }
          return (
            <span key={field}>
              {VALUE_LABELS[field] || field}：{displayValue(entry)}
            </span>
          );
        })}
      </Space>
    );
  }
  return displayValue(value);
}

const ACTION_META: Record<string, { text: string; color: string }> = {
  create: { text: '新增', color: 'green' },
  update: { text: '更新', color: 'blue' },
  move: { text: '移动', color: 'purple' },
  unchanged: { text: '未变化', color: 'default' },
  skipped: { text: '跳过错误', color: 'red' },
  'group-create': { text: '新增空组', color: 'green' },
  'group-update': { text: '更新组', color: 'blue' },
};

const AsinIncrementalImportModal: React.FC<AsinIncrementalImportModalProps> = ({
  visible,
  open,
  onCancel,
  onSuccess,
  competitor,
  api,
}) => {
  const message = useMessage();
  const isOpen = open !== undefined ? open : visible;
  const [tab, setTab] = useState('file');
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [onlineRows, setOnlineRows] = useState<OnlineRow[]>(initialRows);
  const [activeCell, setActiveCell] = useState<{
    rowId: string;
    field: OnlineField;
  } | null>(null);
  const [preview, setPreview] = useState<ImportPreviewPage | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [task, setTask] = useState<{
    taskId: string;
    status?: string | null;
  } | null>(null);
  const [taskMessage, setTaskMessage] = useState('');
  const [progress, setProgress] = useState(0);
  const [result, setResult] =
    useState<ReturnType<typeof extractImportResult>>(null);
  const sourceVersion = useRef(0);
  const sourceFile = useRef<File | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fields: OnlineField[] = competitor
    ? [
        'groupId',
        'groupName',
        'country',
        'brand',
        'asin',
        'asinName',
        'asinType',
      ]
    : [
        'groupId',
        'groupName',
        'country',
        'site',
        'brand',
        'asin',
        'asinName',
        'asinType',
      ];

  const invalidatePreview = () => {
    sourceVersion.current += 1;
    setPreview(null);
    setResult(null);
    setTask(null);
    setTaskMessage('');
    setProgress(0);
  };

  const resetAll = () => {
    invalidatePreview();
    sourceFile.current = null;
    setFileList([]);
    setOnlineRows(initialRows());
    setActiveCell(null);
    setTab('file');
  };

  const previewFile = async (file: File) => {
    invalidatePreview();
    sourceFile.current = file;
    const requestVersion = sourceVersion.current;
    setPreviewing(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await api.preview(formData);
      if (!response.success || !response.data) {
        throw new Error(response.errorMessage || '生成差异预览失败');
      }
      if (mounted.current && requestVersion === sourceVersion.current) {
        setPreview(response.data);
        message.success('差异预览已生成，请核对后确认处理');
      }
    } finally {
      if (mounted.current) setPreviewing(false);
    }
  };

  const handleUpload: UploadProps['customRequest'] = async ({
    file,
    onSuccess: done,
    onError,
  }) => {
    try {
      await previewFile(file as File);
      done?.({});
    } catch (error: any) {
      debugError('ASIN 导入预览失败:', error);
      message.error(
        error?.response?.data?.errorMessage ||
          error.message ||
          '生成差异预览失败',
      );
      onError?.(error);
    }
  };

  const beforeUpload: UploadProps['beforeUpload'] = (file) => {
    if (!/\.(xlsx|csv)$/i.test(file.name)) {
      message.error('仅支持 .xlsx 和 .csv 文件');
      return Upload.LIST_IGNORE;
    }
    if (file.size > MAX_FILE_SIZE) {
      message.error('文件不能超过 10 MB');
      return Upload.LIST_IGNORE;
    }
    return true;
  };

  const updateCell = (rowId: string, field: OnlineField, value: string) => {
    invalidatePreview();
    setOnlineRows((rows) =>
      rows.map((row) => (row.id === rowId ? { ...row, [field]: value } : row)),
    );
  };

  const pasteCells = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (!activeCell) return;
    const text = event.clipboardData.getData('text/plain');
    if (!text.includes('\n') && !text.includes('\t')) return;
    const matrix = text.replace(/\r/g, '').split('\n');
    if (matrix[matrix.length - 1] === '') matrix.pop();
    if (matrix.length === 0) return;
    event.preventDefault();
    invalidatePreview();
    setOnlineRows((rows) => {
      const startRow = rows.findIndex((row) => row.id === activeCell.rowId);
      const startField = fields.indexOf(activeCell.field);
      if (startRow < 0 || startField < 0) return rows;
      const next = [...rows];
      while (next.length < startRow + matrix.length) next.push(emptyRow());
      matrix.forEach((line, rowOffset) => {
        const target = { ...next[startRow + rowOffset] };
        line.split('\t').forEach((cell, columnOffset) => {
          const field = fields[startField + columnOffset];
          if (field) target[field] = cell.trim();
        });
        next[startRow + rowOffset] = target;
      });
      return next;
    });
  };

  const onlineColumns: TableColumnsType<OnlineRow> = [
    {
      title: '#',
      width: 55,
      fixed: 'left',
      className: 'row-index-cell',
      render: (_, __, index) => index + 1,
    },
    ...fields.map((field): TableColumnsType<OnlineRow>[number] => ({
      title: FIELD_LABELS[field],
      dataIndex: field,
      width: field === 'groupName' || field === 'asinName' ? 210 : 140,
      render: (_, row) =>
        field === 'asinType' ? (
          <Select
            className="online-cell-select"
            disabled={confirming}
            value={row.asinType || undefined}
            placeholder="可选"
            options={[
              { value: '1', label: '1 主链' },
              { value: '2', label: '2 副评' },
            ]}
            onFocus={() => setActiveCell({ rowId: row.id, field })}
            onChange={(value) => updateCell(row.id, field, value || '')}
            allowClear
            style={{ width: '100%' }}
          />
        ) : (
          <Input
            className="online-cell-input"
            disabled={confirming}
            value={row[field]}
            placeholder={
              field === 'country'
                ? 'US'
                : field === 'asin'
                ? 'B0XXXXXXXX'
                : undefined
            }
            onFocus={() => setActiveCell({ rowId: row.id, field })}
            onChange={(event) => updateCell(row.id, field, event.target.value)}
          />
        ),
    })),
  ];

  const createOnlineFile = () => {
    const lastFilled = onlineRows.findLastIndex((row) =>
      fields.some((field) => row[field].trim()),
    );
    if (lastFilled < 0) return null;
    const escape = (value: string) => `"${value.trim().replace(/"/g, '""')}"`;
    const rows = [fields.map((field) => FIELD_LABELS[field]).join(',')];
    // Preserve empty spreadsheet lines so preview errors refer to the displayed row number.
    for (const row of onlineRows.slice(0, lastFilled + 1)) {
      rows.push(fields.map((field) => escape(row[field])).join(','));
    }
    return new File(
      ['\ufeff' + rows.join('\n')],
      competitor ? 'online-competitor-import.csv' : 'online-import.csv',
      {
        type: 'text/csv',
      },
    );
  };

  const handleOnlinePreview = async () => {
    const file = createOnlineFile();
    if (!file) {
      message.warning('请至少填写一行数据');
      return;
    }
    try {
      await previewFile(file);
    } catch (error: any) {
      debugError('ASIN 在线导入预览失败:', error);
      message.error(
        error?.response?.data?.errorMessage ||
          error.message ||
          '生成差异预览失败',
      );
    }
  };

  const retryPreview = async () => {
    const file =
      sourceFile.current || (tab === 'online' ? createOnlineFile() : null);
    if (!file) {
      message.warning('请重新选择文件或填写在线数据');
      return;
    }
    try {
      await previewFile(file);
    } catch (error: any) {
      debugError('重新生成 ASIN 导入预览失败:', error);
      message.error(
        error?.response?.data?.errorMessage || error.message || '重新比对失败',
      );
    }
  };

  const loadPage = async (page: number, pageSize: number) => {
    if (!preview) return;
    const { previewId } = preview;
    const requestVersion = sourceVersion.current;
    setPageLoading(true);
    try {
      const response = await api.getPreview(previewId, { page, pageSize });
      if (!response.success || !response.data)
        throw new Error(response.errorMessage || '加载差异明细失败');
      if (mounted.current && requestVersion === sourceVersion.current) {
        setPreview({ ...preview, ...response.data, previewId });
      }
    } catch (error: any) {
      message.error(
        error?.response?.data?.errorMessage ||
          error.message ||
          '加载差异明细失败',
      );
    } finally {
      if (mounted.current) setPageLoading(false);
    }
  };

  const confirmPreview = async () => {
    if (!preview || confirming) return;
    const { previewId } = preview;
    const requestVersion = sourceVersion.current;
    setConfirming(true);
    setTaskMessage('正在创建后台任务');
    try {
      const response = await api.confirm(previewId);
      if (!response.success)
        throw new Error(response.errorMessage || '确认导入失败');
      const created = extractAsyncTask(response);
      if (!created) throw new Error('导入任务未返回任务 ID');
      if (mounted.current && requestVersion === sourceVersion.current) {
        setTask(created);
        setProgress(5);
        setTaskMessage('任务已创建，可在任务中心查看进度');
      }
      message.success('导入任务已创建');
      const completed = await waitForTaskResult(created.taskId, {
        timeoutMs: 30 * 60 * 1000,
        onProgress: (status) => {
          if (!mounted.current || requestVersion !== sourceVersion.current)
            return;
          setTask({ taskId: created.taskId, status: status.status });
          setProgress(
            typeof status.progress === 'number'
              ? Math.max(5, status.progress)
              : 5,
          );
          setTaskMessage(status.message || '正在后台处理');
        },
      });
      const completedResult = extractImportResult(completed);
      if (!completedResult) throw new Error('任务已完成，但未返回导入结果');
      if (mounted.current && requestVersion === sourceVersion.current) {
        setResult(completedResult);
        setTask({ taskId: created.taskId, status: 'completed' });
        setProgress(100);
        setTaskMessage('增量处理完成');
      }
      if (
        (completedResult.createdCount || 0) +
          (completedResult.updatedCount || 0) +
          (completedResult.createdGroupCount || 0) +
          (completedResult.updatedGroupCount || 0) >
        0
      ) {
        await Promise.resolve(onSuccess());
      }
      message[completedResult.failedCount > 0 ? 'warning' : 'success'](
        '增量处理完成',
      );
    } catch (error: any) {
      const text =
        error?.response?.data?.errorMessage || error.message || '导入失败';
      debugError('ASIN 增量处理失败:', error);
      const confirmedStatus = error?.taskStatus;
      if (mounted.current && requestVersion === sourceVersion.current) {
        setTaskMessage(
          confirmedStatus
            ? text
            : `暂时无法确认任务状态：${text}。请在任务中心核对后再重新导入。`,
        );
        setTask((previous) =>
          previous
            ? { ...previous, status: confirmedStatus || 'unknown' }
            : null,
        );
      }
      message.error(text);
    } finally {
      if (mounted.current) setConfirming(false);
    }
  };

  const downloadTemplate = () => {
    const sample: Record<OnlineField, string> = {
      groupId: '',
      groupName: '示例变体组',
      country: 'US',
      site: '12',
      brand: '示例品牌',
      asin: 'B0CHX1W1XY',
      asinName: '',
      asinType: '1',
    };
    const content = [
      fields.map((field) => FIELD_LABELS[field]).join(','),
      fields.map((field) => sample[field]).join(','),
    ].join('\n');
    const url = URL.createObjectURL(
      new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8;' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = competitor ? '竞品ASIN导入模板.csv' : 'ASIN导入模板.csv';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const previewColumns: TableColumnsType<ImportPreviewRow> = [
    { title: '原始行号', dataIndex: 'row', width: 90, fixed: 'left' },
    {
      title: 'ASIN / 国家',
      width: 150,
      render: (_, row) => (
        <>
          {row.asin || '空组'}
          <br />
          {row.country || '—'}
        </>
      ),
    },
    {
      title: '处理',
      dataIndex: 'action',
      width: 105,
      render: (action: string) => (
        <Tag color={ACTION_META[action]?.color || 'default'}>
          {ACTION_META[action]?.text || action}
        </Tag>
      ),
    },
    {
      title: '现有数据',
      dataIndex: 'before',
      width: 260,
      render: displayRecord,
    },
    {
      title: '上传数据',
      dataIndex: 'after',
      width: 260,
      render: displayRecord,
    },
    {
      title: '字段差异',
      width: 280,
      render: (_, row) => (
        <Space direction="vertical" size={4}>
          {row.groupChanges &&
          Array.isArray(row.groupChanges) &&
          row.groupChanges.length > 0 ? (
            <div>
              <Typography.Text strong>变体组：</Typography.Text>
              {displayChanges(row.groupChanges)}
            </div>
          ) : null}
          {displayChanges(row.changes)}
        </Space>
      ),
    },
    {
      title: '错误',
      dataIndex: 'error',
      width: 250,
      render: (error: string) =>
        error ? <Typography.Text type="danger">{error}</Typography.Text> : '—',
    },
  ];

  const summary = preview?.summary;
  const validRowCount = summary ? summary.total - summary.failedCount : 0;

  return (
    <Modal
      title={competitor ? '竞品 ASIN 增量导入' : 'ASIN 增量导入'}
      open={isOpen}
      onCancel={onCancel}
      footer={null}
      width={1180}
    >
      <Tabs
        activeKey={tab}
        onChange={(key) => {
          if (confirming) return;
          setTab(key);
          sourceFile.current = null;
          invalidatePreview();
        }}
        items={[
          {
            key: 'file',
            label: '上传文件',
            children: (
              <>
                <Alert
                  type="info"
                  showIcon
                  message="上传后先预览差异，确认后才会写入数据库"
                  description="支持 .xlsx、.csv，最大 10 MB。可上传旧模板或带变体组 ID 的导出文件；ASIN 为空的空组行也会参与对比。未出现的 ASIN 保留。"
                  style={{ marginBottom: 12 }}
                />
                <Space style={{ marginBottom: 12 }}>
                  <Button
                    icon={<DownloadOutlined />}
                    onClick={downloadTemplate}
                  >
                    下载导入模板
                  </Button>
                </Space>
                <Upload
                  accept=".xlsx,.csv"
                  maxCount={1}
                  fileList={fileList}
                  beforeUpload={beforeUpload}
                  customRequest={handleUpload}
                  disabled={previewing || confirming}
                  onChange={({ file, fileList: next }) => {
                    setFileList(next);
                    if (file.status === 'removed') {
                      sourceFile.current = null;
                      invalidatePreview();
                    }
                  }}
                >
                  <Button
                    icon={<UploadOutlined />}
                    loading={previewing}
                    disabled={previewing || confirming}
                  >
                    {previewing ? '正在比对...' : '选择文件并预览'}
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
                  type="info"
                  showIcon
                  message="可直接编辑或从 Excel 粘贴多行多列；修改后需要重新预览"
                  style={{ marginBottom: 12 }}
                />
                <div className="online-import-sheet" onPaste={pasteCells}>
                  <Table<OnlineRow>
                    rowKey="id"
                    columns={onlineColumns}
                    dataSource={onlineRows}
                    pagination={false}
                    size="small"
                    bordered
                    sticky
                    scroll={{ x: competitor ? 1120 : 1260, y: 360 }}
                  />
                </div>
                <Space wrap>
                  <Button
                    icon={<PlusOutlined />}
                    disabled={previewing || confirming}
                    onClick={() => {
                      invalidatePreview();
                      setOnlineRows((rows) => [
                        ...rows,
                        ...Array.from({ length: 5 }, emptyRow),
                      ]);
                    }}
                  >
                    新增 5 行
                  </Button>
                  <Button
                    icon={<DeleteOutlined />}
                    disabled={
                      previewing || confirming || onlineRows.length <= 1
                    }
                    onClick={() => {
                      invalidatePreview();
                      setOnlineRows((rows) => rows.slice(0, -1));
                    }}
                  >
                    删除末行
                  </Button>
                  <Button
                    disabled={previewing || confirming}
                    onClick={() => {
                      invalidatePreview();
                      setOnlineRows(initialRows());
                      setActiveCell(null);
                    }}
                  >
                    清空表格
                  </Button>
                  <Button
                    type="primary"
                    loading={previewing}
                    disabled={confirming}
                    onClick={handleOnlinePreview}
                  >
                    预览在线数据
                  </Button>
                </Space>
              </>
            ),
          },
        ]}
      />

      {preview && !task && (
        <section style={{ marginTop: 24 }}>
          <Alert
            type={summary?.failedCount ? 'warning' : 'success'}
            showIcon
            message={`差异预览：共 ${summary?.total || 0} 行；新增 ${
              summary?.createdCount || 0
            }，更新 ${summary?.updatedCount || 0}（含移动 ${
              summary?.movedCount || 0
            }），未变化 ${summary?.unchangedCount || 0}，跳过错误 ${
              summary?.failedCount || 0
            }`}
            description={`变体组新增 ${summary?.createdGroupCount || 0}，更新 ${
              summary?.updatedGroupCount || 0
            }；空组行 ${
              summary?.groupOnlyCount || 0
            }。预览 30 分钟内有效，确认时会再次校验数据库状态。`}
            style={{ marginBottom: 12 }}
          />
          <Table<ImportPreviewRow>
            rowKey={(row) => String(row.row)}
            size="small"
            bordered
            loading={pageLoading}
            columns={previewColumns}
            dataSource={preview.rows}
            scroll={{ x: 1400, y: 380 }}
            pagination={{
              current: preview.pagination?.page || 1,
              pageSize: preview.pagination?.pageSize || PAGE_SIZE,
              total: preview.pagination?.total ?? summary?.total ?? 0,
              showSizeChanger: true,
              pageSizeOptions: ['20', '50', '100'],
              showTotal: (total) => `共 ${total} 行`,
              onChange: (page, pageSize) => void loadPage(page, pageSize),
            }}
          />
          <Space style={{ marginTop: 12 }}>
            <Button
              type="primary"
              loading={confirming}
              disabled={validRowCount <= 0 || pageLoading}
              onClick={confirmPreview}
            >
              确认增量处理
            </Button>
            <Button onClick={resetAll} disabled={confirming}>
              重新选择数据
            </Button>
          </Space>
        </section>
      )}

      {task && (
        <Alert
          style={{ marginTop: 20 }}
          type={
            task.status === 'failed'
              ? 'error'
              : task.status === 'completed'
              ? 'success'
              : task.status === 'unknown' || task.status === 'cancelled'
              ? 'warning'
              : 'info'
          }
          showIcon
          message={
            task.status === 'failed'
              ? '导入任务失败'
              : task.status === 'completed'
              ? '导入任务已完成'
              : task.status === 'cancelled'
              ? '导入任务已取消'
              : task.status === 'unknown'
              ? '任务状态待确认'
              : '导入任务正在后台执行'
          }
          description={
            <>
              <div>
                任务 ID：{task.taskId}。{taskMessage}
              </div>
              {task.status !== 'completed' &&
                task.status !== 'failed' &&
                task.status !== 'unknown' &&
                task.status !== 'cancelled' && (
                  <Progress percent={progress} size="small" />
                )}
            </>
          }
          action={
            <Space size={0}>
              {task.status === 'failed' && (
                <Button
                  type="link"
                  size="small"
                  onClick={retryPreview}
                  loading={previewing}
                >
                  重新比对
                </Button>
              )}
              <Button type="link" size="small" onClick={openTaskCenter}>
                任务中心
              </Button>
            </Space>
          }
        />
      )}

      {result && (
        <Alert
          style={{ marginTop: 12 }}
          type={
            result.failedCount > 0 || !result.verificationPassed
              ? 'warning'
              : 'success'
          }
          showIcon
          message={`处理完成：新增 ${result.createdCount || 0}，更新 ${
            result.updatedCount || 0
          }（含移动 ${result.movedCount || 0}），未变化 ${
            result.unchangedCount || 0
          }，跳过错误 ${result.failedCount}`}
          description={`变体组新增 ${result.createdGroupCount || 0}，更新 ${
            result.updatedGroupCount || 0
          }；已分类 ${result.processedCount}/${result.total} 行。`}
          action={
            <Button type="link" size="small" onClick={resetAll}>
              继续导入
            </Button>
          }
        />
      )}
    </Modal>
  );
};

export default AsinIncrementalImportModal;
