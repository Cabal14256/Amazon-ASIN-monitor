import { wsClient } from '@/services/websocket';
import { history, request } from '@umijs/max';
import { debugError } from './debug';

export interface AsyncTaskPayload {
  taskId: string;
  status?: string | null;
  total?: number | null;
}

export type AsyncTaskStatusValue =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'cancelling';

export interface AsyncTaskStatus {
  taskId: string;
  taskType: string;
  taskSubType?: string | null;
  title?: string | null;
  status: AsyncTaskStatusValue;
  progress?: number;
  message?: string | null;
  error?: string | null;
  result?: any;
  filename?: string | null;
  downloadUrl?: string | null;
  canCancel?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
}

export interface AsyncImportResult {
  total: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  missingCount: number;
  verificationPassed: boolean;
  errors?: Array<{ row?: number; message: string }>;
}

interface WaitForTaskOptions {
  intervalMs?: number;
  timeoutMs?: number;
  onProgress?: (task: AsyncTaskStatus) => void;
}

const TASK_STATUS_SET = new Set<AsyncTaskStatusValue>([
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled',
  'cancelling',
]);

function extractResponseData<T>(response: any): T | null {
  if (response && typeof response === 'object' && 'data' in response) {
    return response.data as T;
  }
  return (response as T) || null;
}

function normalizeTaskStatus(
  payload: any,
  fallbackTaskId: string,
): AsyncTaskStatus {
  const data = extractResponseData<any>(payload) || {};
  const normalizedStatus = TASK_STATUS_SET.has(data.status)
    ? data.status
    : 'pending';

  return {
    taskId:
      typeof data.taskId === 'string' && data.taskId.trim()
        ? data.taskId
        : fallbackTaskId,
    taskType: typeof data.taskType === 'string' ? data.taskType : '',
    taskSubType: typeof data.taskSubType === 'string' ? data.taskSubType : null,
    title: typeof data.title === 'string' ? data.title : null,
    status: normalizedStatus,
    progress: typeof data.progress === 'number' ? data.progress : 0,
    message: typeof data.message === 'string' ? data.message : null,
    error: typeof data.error === 'string' ? data.error : null,
    result: data.result ?? null,
    filename: typeof data.filename === 'string' ? data.filename : null,
    downloadUrl: typeof data.downloadUrl === 'string' ? data.downloadUrl : null,
    canCancel: typeof data.canCancel === 'boolean' ? data.canCancel : undefined,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : null,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
    completedAt: typeof data.completedAt === 'string' ? data.completedAt : null,
  };
}

function mergeTaskSnapshot(
  currentTask: AsyncTaskStatus,
  patch: Partial<AsyncTaskStatus>,
): AsyncTaskStatus {
  return {
    ...currentTask,
    ...patch,
    taskId: patch.taskId || currentTask.taskId,
    taskType: patch.taskType || currentTask.taskType,
    status: patch.status || currentTask.status,
    progress:
      typeof patch.progress === 'number'
        ? patch.progress
        : currentTask.progress || 0,
  };
}

function toNumber(value: unknown, fallback = 0) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

export function extractAsyncTask(response: any): AsyncTaskPayload | null {
  const data = extractResponseData<any>(response);
  const taskId = data?.taskId;

  if (typeof taskId !== 'string' || taskId.trim() === '') {
    return null;
  }

  return {
    taskId,
    status: typeof data?.status === 'string' ? data.status : null,
    total: typeof data?.total === 'number' ? data.total : null,
  };
}

export function extractImportResult(payload: any): AsyncImportResult | null {
  const raw =
    payload && typeof payload === 'object' && 'result' in payload
      ? payload.result
      : extractResponseData<any>(payload) || payload;

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const successCount = toNumber(raw.successCount);
  const failedCount = toNumber(raw.failedCount);
  const processedCount =
    toNumber(raw.processedCount, successCount + failedCount) ||
    successCount + failedCount;
  const total = Math.max(toNumber(raw.total, processedCount), processedCount);
  const missingCount = Math.max(
    toNumber(raw.missingCount, total - processedCount),
    0,
  );
  const verificationPassed =
    typeof raw.verificationPassed === 'boolean'
      ? raw.verificationPassed
      : missingCount === 0;

  return {
    total,
    processedCount,
    successCount,
    failedCount,
    missingCount,
    verificationPassed,
    errors: Array.isArray(raw.errors)
      ? raw.errors
          .filter(
            (item: any) =>
              item &&
              typeof item === 'object' &&
              typeof item.message === 'string',
          )
          .map((item: any) => ({
            row: typeof item.row === 'number' ? item.row : undefined,
            message: item.message,
          }))
      : undefined,
  };
}

export function openTaskCenter() {
  history.push('/tasks');
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function fetchTaskStatus(taskId: string): Promise<AsyncTaskStatus> {
  const response = await request<API.Result_any_>(`/api/v1/tasks/${taskId}`, {
    method: 'GET',
  });

  if (!response?.success || !response.data) {
    throw new Error(response?.errorMessage || '查询任务状态失败');
  }

  return normalizeTaskStatus(response, taskId);
}

function buildTaskError(task: AsyncTaskStatus) {
  const message =
    task.error ||
    task.message ||
    (task.status === 'cancelled' ? '任务已取消' : '任务执行失败');
  return new Error(message);
}

export async function waitForTaskResult(
  taskId: string,
  options: WaitForTaskOptions = {},
): Promise<AsyncTaskStatus> {
  const { intervalMs = 1500, timeoutMs = 10 * 60 * 1000, onProgress } = options;
  const startedAt = Date.now();
  let settled = false;
  let lastProgressSignature = '';
  let currentTask: AsyncTaskStatus = {
    taskId,
    taskType: '',
    status: 'pending',
    progress: 0,
    message: '任务已创建，等待处理',
  };

  const emitProgress = (task: AsyncTaskStatus) => {
    currentTask = mergeTaskSnapshot(currentTask, task);
    if (!onProgress) {
      return;
    }

    const signature = [
      currentTask.status,
      String(currentTask.progress || 0),
      currentTask.message || '',
      currentTask.error || '',
    ].join('|');

    if (signature === lastProgressSignature) {
      return;
    }

    lastProgressSignature = signature;
    onProgress(currentTask);
  };

  const settleWithTask = (task: AsyncTaskStatus) => {
    emitProgress(task);
    if (task.status === 'completed') {
      return task;
    }
    if (task.status === 'failed' || task.status === 'cancelled') {
      throw buildTaskError(task);
    }
    return null;
  };

  let unsubscribe: (() => void) | null = null;

  const cleanup = () => {
    settled = true;
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };

  const refreshAndResolve = async () => {
    const latestTask = await fetchTaskStatus(taskId);
    const terminalTask = settleWithTask(latestTask);
    if (terminalTask) {
      cleanup();
      return terminalTask;
    }
    return null;
  };

  try {
    const initialTask = await fetchTaskStatus(taskId);
    const initialTerminalTask = settleWithTask(initialTask);
    if (initialTerminalTask) {
      cleanup();
      return initialTerminalTask;
    }
  } catch (error) {
    cleanup();
    throw error;
  }

  try {
    wsClient.connect();
    unsubscribe = wsClient.onMessage((message: any) => {
      if (settled || !message || message.taskId !== taskId) {
        return;
      }

      if (message.type === 'task_progress') {
        emitProgress({
          taskId,
          taskType: currentTask.taskType,
          taskSubType: currentTask.taskSubType,
          title: currentTask.title,
          status:
            currentTask.status === 'cancelling'
              ? 'cancelling'
              : currentTask.status === 'pending'
              ? 'pending'
              : 'processing',
          progress:
            typeof message.progress === 'number'
              ? message.progress
              : currentTask.progress || 0,
          message:
            typeof message.message === 'string'
              ? message.message
              : currentTask.message,
          error: currentTask.error,
          result: currentTask.result,
          filename: currentTask.filename,
          downloadUrl: currentTask.downloadUrl,
          canCancel: currentTask.canCancel,
          createdAt: currentTask.createdAt,
          updatedAt: currentTask.updatedAt,
          completedAt: currentTask.completedAt,
        });
        return;
      }

      if (
        message.type === 'task_complete' ||
        message.type === 'task_error' ||
        message.type === 'task_cancelled'
      ) {
        void refreshAndResolve().catch((error) => {
          debugError('通过 WebSocket 刷新任务状态失败:', error);
        });
      }
    });
  } catch (error) {
    debugError('初始化任务 WebSocket 监听失败:', error);
  }

  while (Date.now() - startedAt < timeoutMs) {
    await sleep(intervalMs);
    if (settled) {
      break;
    }

    try {
      const latestTask = await fetchTaskStatus(taskId);
      const terminalTask = settleWithTask(latestTask);
      if (terminalTask) {
        cleanup();
        return terminalTask;
      }
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  cleanup();
  throw new Error('任务执行超时');
}
