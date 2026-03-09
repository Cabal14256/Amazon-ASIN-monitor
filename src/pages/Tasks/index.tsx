import taskServices from '@/services/task';
import { formatBeijing } from '@/utils/beijingTime';
import { PageContainer } from '@ant-design/pro-components';
import { ReloadOutlined } from '@ant-design/icons';
import { Button, Popconfirm, Progress, Segmented, Space, Table, Tag, Typography, message } from 'antd';
import type { TableColumnsType } from 'antd';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { wsClient } from '@/services/websocket';

const { listTasks, cancelTask, downloadTaskFile } = taskServices;

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
  result?: Record<string, any> | null;
};

const statusMeta: Record<
  TaskStatus,
  { color: string; text: string }
> = {
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
  if (task.taskType === 'export') {
    return task.filename || result.filename || '文件已生成';
  }
  if (task.taskType === 'import') {
    return `成功 ${result.successCount || 0}，失败 ${result.failedCount || 0}`;
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
  const [filter, setFilter] = useState<'all' | 'active'>('active');

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
    wsClient.connect();
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
      const blob = await downloadTaskFile({ taskId: task.taskId });
      saveBlob(blob, task.filename || `task-${task.taskId}.xlsx`);
      message.success('下载成功');
    } catch (error: any) {
      message.error(error?.message || '下载失败');
    }
  };

  const columns: TableColumnsType<TaskRecord> = [
    {
      title: '任务',
      dataIndex: 'title',
      width: 220,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{record.title || record.taskType}</Typography.Text>
          <Typography.Text type="secondary">
            {record.taskId}
          </Typography.Text>
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
          percent={record.status === 'completed' ? 100 : Math.max(0, Number(value || 0))}
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
      width: 180,
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
          {record.taskType === 'export' && record.status === 'completed' ? (
            <Button size="small" type="link" onClick={() => handleDownloadTask(record)}>
              下载
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
    </PageContainer>
  );
};

export default TaskCenterPage;
