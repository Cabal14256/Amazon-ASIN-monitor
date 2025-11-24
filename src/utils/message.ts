/**
 * Message 工具函数
 * 使用 App.useApp() hook 替代静态 message API
 * 解决 Ant Design v5 的警告问题
 */
import { App } from 'antd';
import { useMemo } from 'react';

/**
 * 自定义 Hook：获取 message 实例
 * 必须在 App 组件内部使用
 */
export function useMessage() {
  const { message } = App.useApp();
  return useMemo(() => message, [message]);
}

/**
 * Message 静态 API 的替代方案
 * 注意：此函数需要在组件内部使用（需要 App 上下文）
 * 
 * 推荐使用方式：
 * const message = useMessage();
 * message.success('操作成功');
 */
export type MessageInstance = ReturnType<typeof App.useApp>['message'];

