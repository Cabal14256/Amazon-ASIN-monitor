import { useRequest } from '@umijs/max';
import { Alert } from 'antd';
import React from 'react';

const GlobalAlert: React.FC = () => {
  const { data } = useRequest<API.Result_SystemAlert_>('/api/v1/system/alert', {
    pollingInterval: 0,
  });

  if (!data?.success || !data?.data?.message) {
    return null;
  }

  return (
    <Alert
      message={data.data.message}
      type={data.data.type || 'info'}
      style={{ margin: '16px 24px 0' }}
      showIcon
    />
  );
};

export default GlobalAlert;
