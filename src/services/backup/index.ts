/* eslint-disable */
import { request } from '@umijs/max';

/** 创建备份 */
export async function createBackup(
  params: {
    // body
    tables?: string[];
    description?: string;
  },
  options?: { [key: string]: any },
) {
  return request<API.Result_BackupInfo__>('/api/v1/backup', {
    method: 'POST',
    data: params,
    ...(options || {}),
  });
}

/** 恢复备份 */
export async function restoreBackup(
  params: {
    // body
    filename: string;
  },
  options?: { [key: string]: any },
) {
  return request<API.Result_any__>('/api/v1/backup/restore', {
    method: 'POST',
    data: params,
    ...(options || {}),
  });
}

/** 获取备份列表 */
export async function listBackups(options?: { [key: string]: any }) {
  return request<API.Result_BackupInfo___>('/api/v1/backup', {
    method: 'GET',
    ...(options || {}),
  });
}

/** 删除备份 */
export async function deleteBackup(
  params: {
    // path
    filename: string;
  },
  options?: { [key: string]: any },
) {
  return request<API.Result_any__>(`/api/v1/backup/${params.filename}`, {
    method: 'DELETE',
    ...(options || {}),
  });
}

/** 下载备份 */
export async function downloadBackup(
  params: {
    // path
    filename: string;
  },
  options?: { [key: string]: any },
) {
  return request(`/api/v1/backup/${params.filename}/download`, {
    method: 'GET',
    responseType: 'blob',
    ...(options || {}),
  });
}

export default {
  createBackup,
  restoreBackup,
  listBackups,
  deleteBackup,
  downloadBackup,
};

