import taskServices from '@/services/task';
import { wsClient } from '@/services/websocket';
import { formatBeijing } from '@/utils/beijingTime';
import { extractImportResult } from '@/utils/task';
import { ReloadOutlined } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import type { TableColumnsType } from 'antd';
import {
  Alert,
  Button,
  Descriptions,
  Modal,
  Popconfirm,
  Progress,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

const { listTasks, getTaskStatus, cancelTask, downloadTaskFile } = taskServices;

type TaskStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'cancelling';

type TaskRecord = {
  taskId: string;
  taskType: string;
  taskSubType?: string | null;
  title: string;
  status: TaskStatus;
  progress: number;
  message?: string | null;
  error?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
  cancelRequestedAt?: string | null;
  canCancel?: boolean;
  filename?: string | null;
  downloadUrl?: string | null;
  result?: any;
};

type StructuredTaskResult = {
  summary?: string;
  verificationPassed?: boolean;
  warnings?: string[];
  filename?: string | null;
  downloadUrl?: string | null;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
  total?: number;
  processedCount?: number;
  successCount?: number;
  failedCount?: number;
  missingCount?: number;
  errors?: Array<{ row?: number; message?: string }>;
  failedSamples?: Array<{ groupId?: string; error?: string }>;
  healthCheck?: {
    passed?: boolean;
    checkedAt?: string;
    message?: string;
  };
};

const statusMeta: Record<TaskStatus, { color: string; text: string }> = {
  pending: { color: 'default', text: '等待中' },
  processing: { color: 'processing', text: '执行中' },
  cancelling: { color: 'warning', text: '取消中' },
  completed: { color: 'success', text: '已完成' },
  failed: { color: 'error', text: '失败' },
  cancelled: { color: 'default', text: '已取消' },
};

function extractResponseData<T>(response: any, fallback: T): T {
  if (response && typeof response === 'object' && 'data' in response) {
    return response.data as T;
  }
  return (response as T) || fallback;
}

function saveBlob(blob: Blob, filename: string) {
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(downloadUrl);
}

function getStructuredTaskResult(
  task: TaskRecord | null | undefined,
): StructuredTaskResult | null {
  const result = task?.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return null;
  }
  return result as StructuredTaskResult;
}

function getTaskWarnings(task: TaskRecord | null | undefined) {
  const warnings = getStructuredTaskResult(task)?.warnings;
  return Array.isArray(warnings)
    ? warnings.filter(
        (item): item is string => typeof item === 'string' && !!item,
      )
    : [];
}

function hasTaskDownload(task: TaskRecord) {
  if (task.status !== 'completed') {
    return false;
  }
  const result = getStructuredTaskResult(task);
  return Boolean(
    task.downloadUrl ||
      task.filename ||
      result?.downloadUrl ||
      result?.filename,
  );
}

function hasStructuredTaskDetail(task: TaskRecord) {
  if (!['completed', 'failed', 'cancelled'].includes(task.status)) {
    return false;
  }
  return Boolean(getStructuredTaskResult(task) || task.error || task.message);
}

function formatFileSize(fileSizeBytes?: number | null) {
  const size = Number(fileSizeBytes);
  if (!Number.isFinite(size) || size <= 0) {
    return '-';
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function getResultSummary(task: TaskRecord) {
  if (task.status === 'failed') {
    return task.error || task.message || '-';
  }
  if (task.status === 'cancelled' || task.status === 'cancelling') {
    return task.message || '等待安全停止';
  }
  if (task.status !== 'completed') {
    return task.message || '-';
  }

  const result = task.result || {};
  if (typeof result.summary === 'string' && result.summary.trim()) {
    return result.summary;
  }
  if (task.taskType === 'export') {
    return task.filename || result.filename || '文件已生成';
  }
  if (task.taskType === 'import') {
    const importResult = extractImportResult(task);
    if (!importResult) {
      return task.message || '导入已完成';
    }
    const summary = `总计 ${importResult.total}，成功 ${importResult.successCount}，失败 ${importResult.failedCount}`;
    return importResult.missingCount > 0
      ? `${summary}，缺失 ${importResult.missingCount}`
      : summary;
  }
  if (task.taskType === 'batch-check') {
    return `成功 ${result.successCount || 0}，失败 ${result.failedCount || 0}`;
  }
  if (task.taskType === 'backup') {
    return result.filename || result.message || '任务已完成';
  }
  return task.message || '-';
}

const TaskCenterPage: React.FC = () => {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'active'>('all');
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [detailTask, setDetailTask] = useState<TaskRecord | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const response = await listTasks({
        status: filter,
        limit: 100,
      });
      setTasks(extractResponseData<TaskRecord[]>(response, []));
    } catch (error: any) {
      message.error(error?.message || '加载任务列表失败');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    const unsubscribe = wsClient.onMessage((msg) => {
      if (
        msg.type === 'task_progress' ||
        msg.type === 'task_complete' ||
        msg.type === 'task_error' ||
        msg.type === 'task_cancelled'
      ) {
        loadTasks();
      }
    });

    const timer = window.setInterval(loadTasks, 5000);

    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [loadTasks]);

  const activeCount = useMemo(
    () =>
      tasks.filter((task) =>
        ['pending', 'processing', 'cancelling'].includes(task.status),
      ).length,
    [tasks],
  );

  const detailImportResult = useMemo(
    () => extractImportResult(detailTask),
    [detailTask],
  );
  const detailResult = useMemo(
    () => getStructuredTaskResult(detailTask),
    [detailTask],
  );
  const detailWarnings = useMemo(
    () => getTaskWarnings(detailTask),
    [detailTask],
  );

  const handleCancelTask = async (taskId: string) => {
    try {
      await cancelTask({ taskId });
      message.success('已发送取消请求');
      loadTasks();
    } catch (error: any) {
      message.error(error?.message || '取消任务失败');
    }
  };

  const handleDownloadTask = async (task: TaskRecord) => {
    try {
      const result = getStructuredTaskResult(task);
      const blob = await downloadTaskFile({ taskId: task.taskId });
      saveBlob(
        blob,
        task.filename || result?.filename || `task-${task.taskId}.bin`,
      );
      message.success('下载成功');
    } catch (error: any) {
      message.error(error?.message || '下载失败');
    }
  };

  const handleViewTaskDetail = async (taskId: string) => {
    setDetailTaskId(taskId);
    setDetailLoading(true);
    try {
      const response = await getTaskStatus({ taskId });
      const detail = extractResponseData<TaskRecord | null>(response, null);
      if (!detail) {
        throw new Error('任务详情不存在');
      }
      setDetailTask(detail);
      setDetailVisible(true);
    } catch (error: any) {
      message.error(error?.message || '加载任务详情失败');
    } finally {
      setDetailLoading(false);
      setDetailTaskId(null);
    }
  };

  const columns: TableColumnsType<TaskRecord> = [
    {
      title: '任务',
      dataIndex: 'title',
      width: 220,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>
            {record.title || record.taskType}
          </Typography.Text>
          <Typography.Text type="secondary">{record.taskId}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (value: TaskStatus) => {
        const meta = statusMeta[value] || statusMeta.pending;
        return <Tag color={meta.color}>{meta.text}</Tag>;
      },
    },
    {
      title: '进度',
      dataIndex: 'progress',
      width: 180,
      render: (value: number, record) => (
        <Progress
          percent={
            record.status === 'completed'
              ? 100
              : Math.max(0, Number(value || 0))
          }
          size="small"
          status={record.status === 'failed' ? 'exception' : 'active'}
        />
      ),
    },
    {
      title: '最新消息',
      dataIndex: 'message',
      ellipsis: true,
      render: (_, record) => record.message || record.error || '-',
    },
    {
      title: '结果',
      dataIndex: 'result',
      width: 260,
      ellipsis: true,
      render: (_, record) => getResultSummary(record),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 180,
      render: (value?: string | null) => (value ? formatBeijing(value) : '-'),
    },
    {
      title: '操作',
      dataIndex: 'actions',
      width: 220,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          {record.canCancel ? (
            <Popconfirm
              title="确认取消任务？"
              description="运行中的任务会在当前批次结束后安全停止。"
              onConfirm={() => handleCancelTask(record.taskId)}
            >
              <Button size="small">取消</Button>
            </Popconfirm>
          ) : null}
          {hasTaskDownload(record) ? (
            <Button
              size="small"
              type="link"
              onClick={() => handleDownloadTask(record)}
            >
              下载
            </Button>
          ) : null}
          {hasStructuredTaskDetail(record) ? (
            <Button
              size="small"
              type="link"
              loading={detailLoading && detailTaskId === record.taskId}
              onClick={() => void handleViewTaskDetail(record.taskId)}
            >
              详情
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <PageContainer
      header={{
        title: '任务中心',
        breadcrumb: {},
        extra: [
          <Segmented
            key="filter"
            value={filter}
            onChange={(value) => setFilter(value as 'all' | 'active')}
            options={[
              { label: `进行中 ${activeCount}`, value: 'active' },
              { label: '全部任务', value: 'all' },
            ]}
          />,
          <Button key="reload" icon={<ReloadOutlined />} onClick={loadTasks}>
            刷新
          </Button>,
        ],
      }}
    >
      <Table<TaskRecord>
        rowKey="taskId"
        loading={loading}
        columns={columns}
        dataSource={tasks}
        scroll={{ x: 1200 }}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          showQuickJumper: true,
          showTotal: (total) => `共 ${total} 条任务`,
        }}
      />
      <Modal
        title={detailTask?.title || '任务详情'}
        open={detailVisible}
        footer={null}
        onCancel={() => {
          setDetailVisible(false);
          setDetailTask(null);
        }}
        width={820}
      >
        {detailTask ? (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Alert
              type={
                detailTask.status === 'failed'
                  ? 'error'
                  : detailTask.status === 'cancelled'
                  ? 'warning'
                  : 'info'
              }
              showIcon
              message={`任务状态：${
                statusMeta[detailTask.status || 'pending']?.text || '未知'
              }`}
              description={
                detailTask.message || detailTask.error || '无附加消息'
              }
            />
            {detailResult ? (
              <>
                <Descriptions bordered size="small" column={2}>
                  <Descriptions.Item label="结果摘要" span={2}>
                    {detailResult.summary || getResultSummary(detailTask)}
                  </Descriptions.Item>
                  <Descriptions.Item label="后台校验">
                    {detailResult.verificationPassed === false
                      ? '未通过'
                      : '通过'}
                  </Descriptions.Item>
                  <Descriptions.Item label="警告数量">
                    {detailWarnings.length}
                  </Descriptions.Item>
                  <Descriptions.Item label="文件名">
                    {detailTask.filename || detailResult.filename || '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="文件大小">
                    {formatFileSize(detailResult.fileSizeBytes)}
                  </Descriptions.Item>
                  {detailResult.healthCheck ? (
                    <Descriptions.Item label="恢复校验" span={2}>
                      {detailResult.healthCheck.message || '-'}
                    </Descriptions.Item>
                  ) : null}
                </Descriptions>
                {detailWarnings.length > 0 ? (
                  <Alert
                    type="warning"
                    showIcon
                    message="任务警告"
                    description={detailWarnings.join('；')}
                  />
                ) : null}
                {detailImportResult ? (
                  <Alert
                    type={
                      detailImportResult.failedCount === 0 &&
                      detailImportResult.missingCount === 0 &&
                      detailImportResult.verificationPassed
                        ? 'success'
                        : 'warning'
                    }
                    showIcon
                    message={`导入结果：总计 ${detailImportResult.total} 条，成功 ${detailImportResult.successCount} 条，失败 ${detailImportResult.failedCount} 条`}
                    description={
                      detailImportResult.verificationPassed
                        ? '后台结果已校验：成功数 + 失败数与总计一致。'
                        : `后台结果校验未通过：仍有 ${detailImportResult.missingCount} 条记录未归类。`
                    }
                  />
                ) : null}
                {detailImportResult?.errors &&
                detailImportResult.errors.length > 0 ? (
                  <Table
                    size="small"
                    rowKey={(_, index) =>
                      `${detailTask.taskId}-import-${index}`
                    }
                    pagination={{ pageSize: 8 }}
                    dataSource={detailImportResult.errors}
                    columns={[
                      {
                        title: '行号',
                        dataIndex: 'row',
                        width: 100,
                        render: (value?: number) => value || '-',
                      },
                      {
                        title: '错误信息',
                        dataIndex: 'message',
                      },
                    ]}
                  />
                ) : null}
                {Array.isArray(detailResult.failedSamples) &&
                detailResult.failedSamples.length > 0 ? (
                  <Table
                    size="small"
                    rowKey={(_, index) =>
                      `${detailTask.taskId}-failed-${index}`
                    }
                    pagination={{ pageSize: 8 }}
                    dataSource={detailResult.failedSamples}
                    columns={[
                      {
                        title: '对象',
                        dataIndex: 'groupId',
                        width: 180,
                        render: (value?: string) => value || '-',
                      },
                      {
                        title: '错误信息',
                        dataIndex: 'error',
                      },
                    ]}
                  />
                ) : null}
              </>
            ) : (
              <Typography.Text type="secondary">
                当前任务没有可展示的结构化结果。
              </Typography.Text>
            )}
          </Space>
        ) : null}
      </Modal>
    </PageContainer>
  );
};

export default TaskCenterPage;
