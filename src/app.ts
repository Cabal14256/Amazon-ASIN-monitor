// 运行时配置

// 全局初始化数据配置，用于 Layout 用户信息和权限初始化
// 更多信息见文档：https://umijs.org/docs/api/runtime-config#getinitialstate
export async function getInitialState(): Promise<{ name: string }> {
  return { name: '@umijs/max' };
}

export const layout = () => {
  return {
    logo: 'https://img.alicdn.com/tfs/TB1YHEpwUT1gK0jSZFhXXaAtVXa-28-27.svg',
    menu: {
      locale: false,
    },
  };
};

// 请求配置
export const request = {
  // 响应拦截器 - 处理后端返回的错误格式
  responseInterceptors: [
    (response: any) => {
      // Umi 的响应拦截器接收的 response 通常是已经解析的数据对象
      // 检查后端返回的 success: false 错误格式
      if (
        response &&
        typeof response === 'object' &&
        response.success === false
      ) {
        const error: any = new Error(response.errorMessage || '请求失败');
        error.data = response;
        error.response = response;
        throw error;
      }
      return response;
    },
  ],
};
