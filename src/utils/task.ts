import { history } from '@umijs/max';

export interface AsyncTaskPayload {
  taskId: string;
  status?: string | null;
  total?: number | null;
}

export function extractAsyncTask(response: any): AsyncTaskPayload | null {
  const data =
    response && typeof response === 'object' && response.data
      ? response.data
      : null;
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

export function openTaskCenter() {
  history.push('/tasks');
}
