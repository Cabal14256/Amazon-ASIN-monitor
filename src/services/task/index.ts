import { request } from '@umijs/max';

export async function listTasks(
  params?: {
    status?: 'all' | 'active' | 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'cancelling';
    limit?: number;
  },
  options?: { [key: string]: any },
) {
  return request<any>('/api/v1/tasks', {
    method: 'GET',
    params,
    ...(options || {}),
  });
}

export async function getTaskStatus(
  params: { taskId: string },
  options?: { [key: string]: any },
) {
  return request<any>(`/api/v1/tasks/${params.taskId}`, {
    method: 'GET',
    ...(options || {}),
  });
}

export async function cancelTask(
  params: { taskId: string },
  options?: { [key: string]: any },
) {
  return request<any>(`/api/v1/tasks/${params.taskId}/cancel`, {
    method: 'POST',
    ...(options || {}),
  });
}

export async function downloadTaskFile(
  params: { taskId: string },
  options?: { [key: string]: any },
) {
  return request<any>(`/api/v1/tasks/${params.taskId}/download`, {
    method: 'GET',
    responseType: 'blob',
    ...(options || {}),
  });
}

export default {
  listTasks,
  getTaskStatus,
  cancelTask,
  downloadTaskFile,
};
