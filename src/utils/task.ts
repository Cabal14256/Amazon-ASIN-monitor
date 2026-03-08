import { request } from '@umijs/max';

export interface AsyncTaskStatus {
  taskId: string;
  taskType: string;
  taskSubType?: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  error?: string | null;
  result?: any;
}

interface WaitForTaskOptions {
  intervalMs?: number;
  timeoutMs?: number;
  onProgress?: (task: AsyncTaskStatus) => void;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export async function waitForTaskResult(
  taskId: string,
  options: WaitForTaskOptions = {},
): Promise<AsyncTaskStatus> {
  const { intervalMs = 1500, timeoutMs = 10 * 60 * 1000, onProgress } = options;
  const startedAt = Date.now();
  let lastProgress = -1;
  let lastStatus = '';

  while (Date.now() - startedAt < timeoutMs) {
    const response = await request<API.Result_any_>(`/api/v1/tasks/${taskId}`, {
      method: 'GET',
    });

    if (!response?.success || !response.data) {
      throw new Error(response?.errorMessage || '查询任务状态失败');
    }

    const task = response.data as AsyncTaskStatus;
    const currentProgress =
      typeof task.progress === 'number' ? task.progress : 0;

    if (
      onProgress &&
      (task.status !== lastStatus || currentProgress !== lastProgress)
    ) {
      onProgress(task);
      lastStatus = task.status;
      lastProgress = currentProgress;
    }

    if (task.status === 'completed') {
      return task;
    }

    if (task.status === 'failed') {
      throw new Error(task.error || '任务执行失败');
    }

    await sleep(intervalMs);
  }

  throw new Error('任务执行超时');
}
