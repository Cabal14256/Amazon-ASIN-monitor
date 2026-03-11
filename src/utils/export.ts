import { cancelTask } from '@/services/task';
import { history } from '@umijs/max';
import { Button, Modal, Progress, message } from 'antd';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { formatBeijingNow } from './beijingTime';
import { debugError } from './debug';
import { waitForTaskResult } from './task';
import { getToken } from './token';

function normalizeBaseURL(baseURL: string): string {
  return baseURL.trim().replace(/\/+$/, '');
}

function resolveApiBaseURL(baseURL: string): string {
  const normalizedBaseURL = normalizeBaseURL(baseURL);
  if (normalizedBaseURL.endsWith('/api/v1')) {
    return normalizedBaseURL.slice(0, -3);
  }
  return normalizedBaseURL;
}

function mergeApiURL(baseURL: string, path: string): string {
  const normalizedBaseURL = resolveApiBaseURL(baseURL);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  if (
    /\/api$/i.test(normalizedBaseURL) &&
    /^\/api(\/|$)/i.test(normalizedPath)
  ) {
    return `${normalizedBaseURL.slice(0, -4)}${normalizedPath}`;
  }

  return `${normalizedBaseURL}${normalizedPath}`;
}

function getExportDateSuffix(): string {
  return formatBeijingNow('YYYY-MM-DD');
}

/**
 * 获取API基础URL
 */
export function getBaseURL(): string {
  // 生产环境：使用环境变量或默认值
  if (process.env.NODE_ENV === 'production') {
    return resolveApiBaseURL(process.env.API_BASE_URL || '/api');
  }
  // 开发环境：使用代理路径
  return resolveApiBaseURL('/api');
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
  const fullURL = mergeApiURL(baseURL, path);

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
    ? `${fullURL}?${queryParams.toString()}`
    : fullURL;
}

/**
 * 进度条 Modal 组件
 */
interface ProgressModalProps {
  visible: boolean;
  progress: number;
  progressMessage: string;
  closable?: boolean;
  onClose?: () => void;
  onOpenTaskCenter?: () => void;
  onCancelTask?: () => void;
  cancelLoading?: boolean;
  extraTip?: string;
}

const ProgressModal: React.FC<ProgressModalProps> = ({
  visible,
  progress,
  progressMessage,
  closable = false,
  onClose,
  onOpenTaskCenter,
  onCancelTask,
  cancelLoading = false,
  extraTip,
}) => {
  const footer: React.ReactNode[] = [];

  if (onOpenTaskCenter) {
    footer.push(
      React.createElement(
        Button,
        {
          key: 'task-center',
          onClick: onOpenTaskCenter,
        },
        '任务中心',
      ),
    );
  }

  if (closable && onClose) {
    footer.push(
      React.createElement(
        Button,
        {
          key: 'background',
          type: 'primary',
          onClick: onClose,
        },
        '转入后台',
      ),
    );
  }

  if (onCancelTask) {
    footer.push(
      React.createElement(
        Button,
        {
          key: 'cancel-task',
          danger: true,
          loading: cancelLoading,
          onClick: onCancelTask,
        },
        '取消任务',
      ),
    );
  }

  return React.createElement(
    Modal,
    {
      open: visible,
      title: '导出进度',
      footer: footer.length > 0 ? footer : null,
      closable,
      maskClosable: closable,
      onCancel: closable ? onClose : undefined,
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
      extraTip
        ? React.createElement(
            'div',
            {
              style: {
                marginTop: 8,
                textAlign: 'center',
                color: '#999',
                fontSize: 12,
              },
            },
            extraTip,
          )
        : null,
    ),
  );
};

/**
 * 导出类型映射
 */
const EXPORT_TYPE_MAP: Record<string, string> = {
  '/v1/export/asin': 'asin',
  '/api/v1/export/asin': 'asin',
  '/v1/export/monitor-history': 'monitor-history',
  '/api/v1/export/monitor-history': 'monitor-history',
  '/v1/export/variant-group': 'variant-group',
  '/api/v1/export/variant-group': 'variant-group',
  '/v1/export/competitor-asin': 'competitor-asin',
  '/api/v1/export/competitor-asin': 'competitor-asin',
  '/v1/export/competitor-variant-group': 'competitor-variant-group',
  '/api/v1/export/competitor-variant-group': 'competitor-variant-group',
  '/v1/export/competitor-monitor-history': 'competitor-monitor-history',
  '/api/v1/export/competitor-monitor-history': 'competitor-monitor-history',
  '/v1/export/analytics-monthly-breakdown': 'analytics-monthly-breakdown',
  '/api/v1/export/analytics-monthly-breakdown': 'analytics-monthly-breakdown',
  '/v1/export/parent-asin-query': 'parent-asin-query',
  '/api/v1/export/parent-asin-query': 'parent-asin-query',
};

function normalizeExportPath(url: string): string {
  if (!url) {
    return url;
  }

  return url.startsWith('/api/') ? url.replace(/^\/api/i, '') : url;
}

function buildAuthHeaders(
  token: string | null,
  includeJsonContentType = false,
): HeadersInit {
  const headers: HeadersInit = {};

  if (includeJsonContentType) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function getFilenameFromDisposition(
  contentDisposition: string | null,
  fallbackFilename: string,
) {
  if (!contentDisposition) {
    return fallbackFilename;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch (error) {
      return utf8Match[1];
    }
  }

  const asciiMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  if (asciiMatch?.[1]) {
    return asciiMatch[1];
  }

  return fallbackFilename;
}

function ensureFileExtension(filename: string, extension: string) {
  return filename.toLowerCase().endsWith(extension.toLowerCase())
    ? filename
    : `${filename}${extension}`;
}

async function downloadBlobWithAuth(
  url: string,
  token: string | null,
  fallbackFilename: string,
) {
  const response = await fetch(url, {
    method: 'GET',
    headers: buildAuthHeaders(token),
    credentials: 'include',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.errorMessage || '下载失败');
  }

  const blob = await response.blob();
  const resolvedFilename = getFilenameFromDisposition(
    response.headers.get('content-disposition'),
    fallbackFilename,
  );
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = resolvedFilename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(downloadUrl);
}

/**
 * 后台任务导出（使用任务队列）
 * @param url 导出API地址（相对路径，如 '/v1/export/asin'）
 * @param params 查询参数
 * @param filename 文件名（不含扩展名）
 */
export async function exportToExcelAsync(
  url: string,
  params: Record<string, any> = {},
  filename?: string,
): Promise<void> {
  // 确定导出类型
  const normalizedUrl = normalizeExportPath(url);
  const exportType = EXPORT_TYPE_MAP[normalizedUrl];
  if (!exportType) {
    throw new Error(`不支持的导出类型: ${url}`);
  }

  // 创建进度条容器
  const progressContainer = document.createElement('div');
  document.body.appendChild(progressContainer);
  const root = ReactDOM.createRoot(progressContainer);

  let progress = 0;
  let progressMessage = '正在创建任务...';
  const modalState = { visible: true };
  let taskId: string | null = null;
  let modalClosable = false;
  let cancelLoading = false;
  let disposed = false;
  let modalDestroyed = false;
  let backgrounded = false;

  const destroyModal = () => {
    if (modalDestroyed) {
      return;
    }
    modalDestroyed = true;
    root.unmount();
    if (document.body.contains(progressContainer)) {
      document.body.removeChild(progressContainer);
    }
  };

  const cleanup = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    destroyModal();
  };

  const renderModal = () => {
    if (disposed || modalDestroyed) {
      return;
    }

    root.render(
      React.createElement(ProgressModal, {
        visible: modalState.visible,
        progress,
        progressMessage,
        closable: modalClosable,
        onClose: modalClosable
          ? () => {
              modalState.visible = false;
              backgrounded = true;
              destroyModal();
              message.info(
                '导出任务已转入后台，完成后会自动下载，也可在任务中心查看或取消',
              );
            }
          : undefined,
        onOpenTaskCenter: taskId
          ? () => {
              modalState.visible = false;
              backgrounded = true;
              destroyModal();
              history.push('/tasks');
            }
          : undefined,
        onCancelTask: taskId
          ? async () => {
              if (cancelLoading || !taskId) {
                return;
              }

              cancelLoading = true;
              renderModal();

              try {
                await cancelTask({ taskId });
                message.success('已发送取消请求');
              } catch (error: any) {
                message.error(error?.message || '取消任务失败');
              } finally {
                cancelLoading = false;
                renderModal();
              }
            }
          : undefined,
        cancelLoading,
        extraTip: taskId
          ? '可关闭窗口，稍后在任务中心查看进度或取消任务。'
          : undefined,
      }),
    );
  };

  const updateProgress = (newProgress: number, msg: string) => {
    progress = newProgress;
    progressMessage = msg;
    renderModal();
  };

  renderModal();

  try {
    const baseURL = getBaseURL();
    const token = getToken();

    // 创建导出任务
    const createTaskResponse = await fetch(
      mergeApiURL(baseURL, '/v1/tasks/export'),
      {
        method: 'POST',
        headers: buildAuthHeaders(token, true),
        credentials: 'include',
        body: JSON.stringify({
          exportType,
          params,
        }),
      },
    );

    if (!createTaskResponse.ok) {
      const errorData = await createTaskResponse.json().catch(() => ({}));
      throw new Error(errorData.errorMessage || '创建导出任务失败');
    }

    const taskData = await createTaskResponse.json();
    if (!taskData.success || !taskData.data?.taskId) {
      throw new Error('创建导出任务失败：未返回任务ID');
    }

    taskId = taskData.data.taskId;
    modalClosable = true;
    updateProgress(5, '任务已创建，等待处理...');
    void (async () => {
      try {
        const completedTask = await waitForTaskResult(taskId!, {
          timeoutMs: 30 * 60 * 1000,
          onProgress: (task) => {
            if (disposed) {
              return;
            }

            const nextProgress =
              typeof task.progress === 'number'
                ? Math.max(0, Math.min(100, task.progress))
                : 0;
            const nextMessage =
              task.message ||
              (task.status === 'pending'
                ? '任务已入队，等待处理...'
                : `正在处理... (${nextProgress}%)`);
            updateProgress(nextProgress, nextMessage);
          },
        });

        if (disposed) {
          return;
        }

        const fallbackFilename = ensureFileExtension(
          completedTask.filename ||
            completedTask.result?.filename ||
            filename ||
            `导出数据_${getExportDateSuffix()}`,
          '.xlsx',
        );

        if (!backgrounded) {
          updateProgress(100, '导出完成，正在下载...');
        }

        await downloadBlobWithAuth(
          mergeApiURL(
            baseURL,
            completedTask.downloadUrl || `/v1/tasks/${taskId}/download`,
          ),
          token,
          fallbackFilename,
        );

        message.success(
          backgrounded ? '后台导出已完成，文件开始下载' : '导出成功',
        );
      } catch (error: any) {
        const errorMessage = error?.message || '导出失败，请重试';
        if (!backgrounded && !disposed) {
          updateProgress(0, errorMessage);
        }
        if (errorMessage.includes('取消')) {
          message.warning(errorMessage);
        } else if (errorMessage.includes('下载')) {
          message.error(`${errorMessage}，请到任务中心手动下载`);
        } else {
          message.error(errorMessage);
        }
      } finally {
        cleanup();
      }
    })();
  } catch (error: any) {
    debugError('异步导出失败:', error);
    modalState.visible = false;
    updateProgress(0, '导出失败');
    message.error(error?.message || '导出失败，请重试');
    cleanup();
    throw error;
  }
}

/**
 * 导出数据为Excel（带进度条）
 * @param url 导出API地址（相对路径，如 '/v1/export/asin'）
 * @param params 查询参数
 * @param filename 文件名（不含扩展名）
 * @param useAsync 是否使用后台任务模式（默认true）
 */
export async function exportToExcel(
  url: string,
  params: Record<string, any> = {},
  filename?: string,
  useAsync: boolean = true,
) {
  // 如果使用异步模式，调用后台任务导出
  if (useAsync) {
    return exportToExcelAsync(url, params, filename);
  }

  // 创建进度条容器
  const progressContainer = document.createElement('div');
  document.body.appendChild(progressContainer);
  const root = ReactDOM.createRoot(progressContainer);

  let progress = 0;
  let progressMessage = '正在初始化...';
  const modalState = { visible: true };

  const updateProgress = (newProgress: number, msg: string) => {
    progress = newProgress;
    progressMessage = msg;
    root.render(
      React.createElement(ProgressModal, {
        visible: modalState.visible,
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

    const token = getToken();

    // 获取baseURL并构建完整URL
    const baseURL = getBaseURL();
    const fullUrl = `${mergeApiURL(baseURL, url)}?${queryParams.toString()}`;

    // 使用 fetch + ReadableStream 接收 SSE 进度更新（因为需要自定义 headers）
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: buildAuthHeaders(token),
      credentials: 'include',
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

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (value) {
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
                    updateProgress(
                      data.progress,
                      data.message || '正在处理...',
                    );
                  } else if (data.type === 'redirect') {
                    // 文件太大，改用直接下载
                    updateProgress(
                      95,
                      data.message || '文件较大，改用直接下载...',
                    );

                    // 关闭当前SSE连接
                    try {
                      reader.cancel();
                    } catch (e) {
                      // 忽略取消错误
                    }

                    // 重新发起直接下载请求（不使用进度模式）
                    // 使用立即执行函数捕获所有需要的变量，避免 ESLint 警告
                    ((
                      redirectData: typeof data,
                      currentModalState: typeof modalState,
                      currentRoot: typeof root,
                      currentProgressContainer: typeof progressContainer,
                      currentFullUrl: string,
                      currentToken: string | null,
                      currentFilename: string | undefined,
                    ) => {
                      setTimeout(async () => {
                        try {
                          const redirectUrl =
                            redirectData.downloadUrl ||
                            currentFullUrl.replace(
                              'useProgress=true',
                              'useProgress=false',
                            );
                          const redirectResponse = await fetch(redirectUrl, {
                            method: 'GET',
                            headers: buildAuthHeaders(currentToken),
                            credentials: 'include',
                          });

                          if (!redirectResponse.ok) {
                            throw new Error('直接下载失败');
                          }

                          updateProgress(100, '正在下载文件...');
                          const blob = await redirectResponse.blob();

                          const downloadUrl = window.URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = downloadUrl;
                          a.download = currentFilename
                            ? `${currentFilename}_${getExportDateSuffix()}.xlsx`
                            : `导出数据_${getExportDateSuffix()}.xlsx`;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          window.URL.revokeObjectURL(downloadUrl);

                          // 关闭进度条
                          currentModalState.visible = false;
                          currentRoot.render(
                            React.createElement(ProgressModal, {
                              visible: currentModalState.visible,
                              progress: 100,
                              progressMessage: '导出完成',
                            }),
                          );
                          setTimeout(() => {
                            currentRoot.unmount();
                            document.body.removeChild(currentProgressContainer);
                          }, 500);

                          message.success('导出成功');
                        } catch (redirectError: any) {
                          debugError('导出直链下载失败:', redirectError);
                          currentModalState.visible = false;
                          currentRoot.render(
                            React.createElement(ProgressModal, {
                              visible: currentModalState.visible,
                              progress: 0,
                              progressMessage: '导出失败',
                            }),
                          );
                          setTimeout(() => {
                            currentRoot.unmount();
                            document.body.removeChild(currentProgressContainer);
                          }, 1000);
                          message.error('直接下载失败，请重试');
                        }
                      }, 500);
                    })(
                      data,
                      modalState,
                      root,
                      progressContainer,
                      fullUrl,
                      token,
                      filename,
                    );
                    return;
                  } else if (data.type === 'complete') {
                    updateProgress(100, '导出完成，正在下载...');

                    // 将 base64 数据转换为 blob
                    try {
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
                          ? `${filename}_${getExportDateSuffix()}.xlsx`
                          : `导出数据_${getExportDateSuffix()}.xlsx`);
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      window.URL.revokeObjectURL(downloadUrl);

                      // 关闭进度条
                      modalState.visible = false;
                      root.render(
                        React.createElement(ProgressModal, {
                          visible: modalState.visible,
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
                    } catch (blobError) {
                      debugError('处理导出文件数据失败:', blobError);
                      throw new Error(
                        '处理导出文件失败: ' + (blobError as Error).message,
                      );
                    }
                  } else if (data.type === 'error') {
                    throw new Error(data.errorMessage || '导出失败');
                  }
                } catch (e) {
                  debugError('解析导出 SSE 数据失败:', e, dataLine);
                  // 如果是 JSON 解析错误，继续处理，可能是数据不完整
                  // 如果是其他错误，可能需要抛出
                  if (e instanceof Error && !e.message.includes('JSON')) {
                    throw e;
                  }
                }
              }
            }
          }
        }
      } catch (streamError) {
        debugError('读取导出 SSE 流失败:', streamError);
        throw new Error(
          '读取导出数据流失败: ' + (streamError as Error).message,
        );
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
        ? `${filename}_${getExportDateSuffix()}.xlsx`
        : `导出数据_${getExportDateSuffix()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);

      // 关闭进度条
      modalState.visible = false;
      root.render(
        React.createElement(ProgressModal, {
          visible: modalState.visible,
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
    debugError('同步导出失败:', error);

    // 关闭进度条
    modalState.visible = false;
    root.render(
      React.createElement(ProgressModal, {
        visible: modalState.visible,
        progress: 0,
        progressMessage: '导出失败',
      }),
    );
    setTimeout(() => {
      root.unmount();
      document.body.removeChild(progressContainer);
    }, 1000);

    // 处理不同类型的错误
    let errorMessage = '导出失败，请重试';
    if (error?.message) {
      errorMessage = error.message;
    } else if (
      error?.name === 'TypeError' &&
      error?.message?.includes('network')
    ) {
      errorMessage = '网络连接错误，请检查网络连接后重试';
    } else if (error?.name === 'AbortError') {
      errorMessage = '导出请求被取消';
    } else if (error?.message?.includes('ERR_INCOMPLETE_CHUNKED_ENCODING')) {
      errorMessage = '导出数据流中断，可能是文件过大或网络不稳定，请重试';
    }

    message.error(errorMessage);
  }
}
