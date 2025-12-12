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

/** 获取自动备份配置 */
export async function getBackupConfig(options?: { [key: string]: any }) {
  return request<API.Result_BackupConfig__>('/api/v1/backup/config', {
    method: 'GET',
    ...(options || {}),
  });
}

/** 保存自动备份配置 */
export async function saveBackupConfig(
  params: {
    // body
    enabled?: boolean;
    scheduleType?: 'daily' | 'weekly' | 'monthly';
    scheduleValue?: number;
    backupTime?: string;
  },
  options?: { [key: string]: any },
) {
  return request<API.Result_BackupConfig__>('/api/v1/backup/config', {
    method: 'POST',
    data: params,
    ...(options || {}),
  });
}

export default {
  createBackup,
  restoreBackup,
  listBackups,
  deleteBackup,
  downloadBackup,
  getBackupConfig,
  saveBackupConfig,
};
