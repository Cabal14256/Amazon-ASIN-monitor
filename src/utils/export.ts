import { Modal, Progress, message } from 'antd';
import React from 'react';
import ReactDOM from 'react-dom/client';

/**
 * 获取API基础URL
 */
export function getBaseURL(): string {
  // 生产环境：使用环境变量或默认值
  if (process.env.NODE_ENV === 'production') {
    return process.env.API_BASE_URL || '/api';
  }
  // 开发环境：使用代理路径
  return '/api';
}

/**
 * 构建完整的导出URL
 * @param path 相对路径（如 '/v1/export/asin'）
 * @param params 查询参数
 */
export function buildExportURL(
  path: string,
  params: Record<string, any> = {},
): string {
  const baseURL = getBaseURL();
  const normalizedBaseURL = baseURL.endsWith('/')
    ? baseURL.slice(0, -1)
    : baseURL;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  const queryParams = new URLSearchParams();
  Object.keys(params).forEach((key) => {
    if (
      params[key] !== undefined &&
      params[key] !== null &&
      params[key] !== ''
    ) {
      queryParams.append(key, String(params[key]));
    }
  });

  return queryParams.toString()
    ? `${normalizedBaseURL}${normalizedPath}?${queryParams.toString()}`
    : `${normalizedBaseURL}${normalizedPath}`;
}

/**
 * 进度条 Modal 组件
 */
interface ProgressModalProps {
  visible: boolean;
  progress: number;
  progressMessage: string;
}

const ProgressModal: React.FC<ProgressModalProps> = ({
  visible,
  progress,
  progressMessage,
}) => {
  return React.createElement(
    Modal,
    {
      open: visible,
      title: '导出进度',
      footer: null,
      closable: false,
      maskClosable: false,
      width: 400,
    },
    React.createElement(
      'div',
      { style: { padding: '20px 0' } },
      React.createElement(Progress, {
        percent: progress,
        status: progress === 100 ? 'success' : 'active',
        strokeColor: {
          '0%': '#108ee9',
          '100%': '#87d068',
        },
      }),
      React.createElement(
        'div',
        { style: { marginTop: 16, textAlign: 'center', color: '#666' } },
        progressMessage,
      ),
    ),
  );
};

/**
 * 导出数据为Excel（带进度条）
 * @param url 导出API地址（相对路径，如 '/v1/export/asin'）
 * @param params 查询参数
 * @param filename 文件名（不含扩展名）
 */
export async function exportToExcel(
  url: string,
  params: Record<string, any> = {},
  filename?: string,
) {
  // 创建进度条容器
  const progressContainer = document.createElement('div');
  document.body.appendChild(progressContainer);
  const root = ReactDOM.createRoot(progressContainer);

  let progress = 0;
  let progressMessage = '正在初始化...';
  let modalVisible = true;

  const updateProgress = (newProgress: number, msg: string) => {
    progress = newProgress;
    progressMessage = msg;
    root.render(
      React.createElement(ProgressModal, {
        visible: modalVisible,
        progress: progress,
        progressMessage: progressMessage,
      }),
    );
  };

  try {
    // 构建查询字符串，添加 useProgress 参数
    const queryParams = new URLSearchParams();
    Object.keys(params).forEach((key) => {
      if (
        params[key] !== undefined &&
        params[key] !== null &&
        params[key] !== ''
      ) {
        queryParams.append(key, String(params[key]));
      }
    });
    queryParams.append('useProgress', 'true');

    const token = localStorage.getItem('token');

    // 获取baseURL并构建完整URL
    const baseURL = getBaseURL();
    const normalizedBaseURL = baseURL.endsWith('/')
      ? baseURL.slice(0, -1)
      : baseURL;
    const normalizedUrl = url.startsWith('/') ? url : `/${url}`;
    const fullUrl = `${normalizedBaseURL}${normalizedUrl}?${queryParams.toString()}`;

    // 使用 fetch + ReadableStream 接收 SSE 进度更新（因为需要自定义 headers）
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.errorMessage || '导出失败');
    }

    // 检查是否是 SSE 响应
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('text/event-stream')) {
      // 使用 SSE 模式
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (!reader) {
        throw new Error('无法读取响应流');
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE 格式：data: {json}\n\n，需要按 \n\n 分割消息
        const sseMessages = buffer.split('\n\n');
        buffer = sseMessages.pop() || ''; // 保留最后一个不完整的消息

        for (const sseMessage of sseMessages) {
          const lines = sseMessage.split('\n');
          let dataLine = '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              dataLine = line.slice(6);
              break;
            }
          }

          if (dataLine) {
            try {
              const data = JSON.parse(dataLine);

              if (data.type === 'progress') {
                updateProgress(data.progress, data.message || '正在处理...');
              } else if (data.type === 'complete') {
                updateProgress(100, '导出完成，正在下载...');

                // 将 base64 数据转换为 blob
                const binaryString = atob(data.data);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }
                const blob = new Blob([bytes], {
                  type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                });

                // 下载文件
                const downloadUrl = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = downloadUrl;
                a.download =
                  data.filename ||
                  (filename
                    ? `${filename}_${
                        new Date().toISOString().split('T')[0]
                      }.xlsx`
                    : `导出数据_${
                        new Date().toISOString().split('T')[0]
                      }.xlsx`);
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(downloadUrl);

                // 关闭进度条
                modalVisible = false;
                root.render(
                  React.createElement(ProgressModal, {
                    visible: modalVisible,
                    progress: 100,
                    progressMessage: '导出完成',
                  }),
                );
                setTimeout(() => {
                  root.unmount();
                  document.body.removeChild(progressContainer);
                }, 500);

                message.success('导出成功');
                return;
              } else if (data.type === 'error') {
                throw new Error(data.errorMessage || '导出失败');
              }
            } catch (e) {
              console.error('解析 SSE 数据失败:', e, dataLine);
            }
          }
        }
      }
    } else {
      // 传统模式（兼容旧版本）
      updateProgress(50, '正在下载文件...');
      const blob = await response.blob();
      updateProgress(100, '导出完成，正在下载...');

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

      // 关闭进度条
      modalVisible = false;
      root.render(
        React.createElement(ProgressModal, {
          visible: modalVisible,
          progress: 100,
          progressMessage: '导出完成',
        }),
      );
      setTimeout(() => {
        root.unmount();
        document.body.removeChild(progressContainer);
      }, 500);

      message.success('导出成功');
    }
  } catch (error: any) {
    console.error('导出失败:', error);

    // 关闭进度条
    modalVisible = false;
    root.render(
      React.createElement(ProgressModal, {
        visible: modalVisible,
        progress: 0,
        progressMessage: '导出失败',
      }),
    );
    setTimeout(() => {
      root.unmount();
      document.body.removeChild(progressContainer);
    }, 1000);

    message.error(error?.message || '导出失败，请重试');
  }
}
