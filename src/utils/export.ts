import { message } from 'antd';

/**
 * 导出数据为Excel
 * @param url 导出API地址
 * @param params 查询参数
 * @param filename 文件名（不含扩展名）
 */
export async function exportToExcel(
  url: string,
  params: Record<string, any> = {},
  filename?: string,
) {
  try {
    const hide = message.loading('正在导出，请稍候...', 0);

    // 构建查询字符串
    const queryParams = new URLSearchParams();
    Object.keys(params).forEach((key) => {
      if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
        queryParams.append(key, String(params[key]));
      }
    });

    const token = localStorage.getItem('token');
    const fullUrl = queryParams.toString()
      ? `${url}?${queryParams.toString()}`
      : url;

    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    hide();

    if (response.ok) {
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename
        ? `${filename}_${new Date().toISOString().split('T')[0]}.xlsx`
        : `导出数据_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
      message.success('导出成功');
    } else {
      const errorData = await response.json().catch(() => ({}));
      message.error(errorData.errorMessage || '导出失败');
    }
  } catch (error) {
    console.error('导出失败:', error);
    message.error('导出失败，请重试');
  }
}

