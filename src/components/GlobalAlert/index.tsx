import { request, useRequest } from '@umijs/max';
import { Alert } from 'antd';
import React from 'react';

const GlobalAlert: React.FC = () => {
  const { data } = useRequest(
    () => request<API.Result_SystemAlert_>('/api/v1/system/alert'),
    {
      pollingInterval: 0,
      formatResult: (response) => response?.data,
    },
  );
  const alertData = data as API.Result_SystemAlert_['data'] | undefined;

  if (!alertData?.message) {
    return null;
  }

  return (
    <Alert
      message={alertData.message}
      type={alertData.type || 'info'}
      style={{ margin: '16px 24px 0' }}
      showIcon
    />
  );
};

export default GlobalAlert;
