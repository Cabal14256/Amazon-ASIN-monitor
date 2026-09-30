import {
  ProFormDigit,
  ProFormRadio,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
} from '@ant-design/pro-components';
import { Alert, Divider, Form } from 'antd';
import React from 'react';

export function buildFeishuEmergencyValues(
  config?: Partial<API.FeishuEmergencyConfig>,
): API.FeishuEmergencyConfig {
  return {
    enabled: false,
    timeMode: 'rolling',
    windowMinutes: 30,
    startTime: '22:00',
    endTime: '08:00',
    threshold: 10,
    cooldownMinutes: 60,
    ...config,
    userIds: [...(config?.userIds || [])],
  };
}

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const validContact = (value: string) =>
  value.length <= 128 && /^ou_[A-Za-z0-9_-]+$/.test(value);

export function buildFeishuEmergencyPayload(
  values: Partial<API.FeishuEmergencyConfig> | undefined,
  saved: API.FeishuEmergencyConfig | undefined,
): API.FeishuEmergencyConfig {
  const result = buildFeishuEmergencyValues(values);
  const fallback = buildFeishuEmergencyValues(saved);
  // Keep valid values in hidden fields, but discard invalid, inactive drafts.
  const integerFields = [
    ['windowMinutes', 1, 1440, !result.enabled || result.timeMode === 'daily'],
    ['threshold', 0, 1000000, !result.enabled],
    ['cooldownMinutes', 5, 10080, !result.enabled],
  ] as const;
  integerFields.forEach(([key, min, max, hidden]) => {
    if (
      hidden &&
      (!Number.isInteger(result[key]) || result[key] < min || result[key] > max)
    ) {
      result[key] = fallback[key];
    }
  });
  if (!result.enabled || result.timeMode === 'rolling') {
    (['startTime', 'endTime'] as const).forEach((key) => {
      if (!timePattern.test(result[key])) result[key] = fallback[key];
    });
  }
  if (!result.enabled) {
    if (result.startTime === result.endTime) {
      result.startTime = fallback.startTime;
      result.endTime = fallback.endTime;
    }
    if (result.userIds.length > 10 || !result.userIds.every(validContact)) {
      result.userIds = fallback.userIds;
    }
  }
  return result;
}

const FeishuEmergencyFields: React.FC<{ region: 'US' | 'EU' }> = ({
  region,
}) => {
  const form = Form.useFormInstance();
  const enabled = Form.useWatch([region, 'emergency', 'enabled'], form);
  const timeMode =
    Form.useWatch([region, 'emergency', 'timeMode'], form) || 'rolling';
  const fieldName = (name: keyof API.FeishuEmergencyConfig) => [
    region,
    'emergency',
    name,
  ];

  return (
    <>
      <Divider orientation="left">紧急状态与电话加急</Divider>
      <ProFormSwitch
        name={fieldName('enabled')}
        label="启用电话加急"
        checkedChildren="启用"
        unCheckedChildren="禁用"
        extra="仅在本区域飞书通知启用时生效；每次监控结束后判断，冷却期间不重复拨打。"
      />
      {enabled && (
        <>
          <Alert
            type="info"
            showIcon
            message="异常变体超过阈值时触发"
            description="统计指定窗口内曾出现异常的不同 ASIN，按国家 + ASIN 去重，仅包含开启通知的 ASIN 及所属组。数量严格大于阈值时，在飞书通知的同时向指定联系人发送电话加急。"
            style={{ marginBottom: 24 }}
          />
          <ProFormRadio.Group
            name={fieldName('timeMode')}
            label="时间段模式"
            options={[
              { label: '最近 N 分钟', value: 'rolling' },
              { label: '每日固定时段', value: 'daily' },
              { label: '固定时段内最近 N 分钟', value: 'combined' },
            ]}
            rules={[{ required: true, message: '请选择时间段模式' }]}
          />
          {timeMode !== 'daily' && (
            <ProFormDigit
              name={fieldName('windowMinutes')}
              label="统计窗口（分钟）"
              min={1}
              max={1440}
              fieldProps={{ precision: 0 }}
              rules={[
                { required: true, message: '请输入统计窗口' },
                {
                  type: 'integer',
                  min: 1,
                  max: 1440,
                  message: '统计窗口须为 1–1440 的整数',
                },
              ]}
              extra={
                timeMode === 'combined'
                  ? '仅在固定时段内判断，统计最近 N 分钟与当前固定时段的重叠部分。'
                  : '每次监控结束时，统计此前 N 分钟内出现过异常的变体。'
              }
            />
          )}
          {timeMode !== 'rolling' && (
            <>
              <ProFormText
                name={fieldName('startTime')}
                label="每日开始时间（北京时间）"
                placeholder="22:00"
                fieldProps={{ type: 'time', step: 60 }}
                rules={[
                  { required: true, message: '请输入开始时间' },
                  { pattern: timePattern, message: '时间格式须为 HH:mm' },
                ]}
              />
              <ProFormText
                name={fieldName('endTime')}
                label="每日结束时间（北京时间）"
                placeholder="08:00"
                fieldProps={{ type: 'time', step: 60 }}
                dependencies={[fieldName('startTime')]}
                rules={[
                  { required: true, message: '请输入结束时间' },
                  { pattern: timePattern, message: '时间格式须为 HH:mm' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      return value &&
                        value === getFieldValue(fieldName('startTime'))
                        ? Promise.reject(new Error('开始与结束时间不能相同'))
                        : Promise.resolve();
                    },
                  }),
                ]}
                extra={
                  timeMode === 'daily'
                    ? '支持跨午夜，例如 22:00–08:00。仅在此时段内判断，累计本次时段开始后出现过异常的变体。'
                    : '支持跨午夜，例如 22:00–08:00；固定时段之外不触发电话加急。'
                }
              />
            </>
          )}
          <ProFormDigit
            name={fieldName('threshold')}
            label="异常变体数阈值"
            min={0}
            max={1000000}
            fieldProps={{ precision: 0 }}
            rules={[
              { required: true, message: '请输入异常变体数阈值' },
              {
                type: 'integer',
                min: 0,
                max: 1000000,
                message: '阈值须为 0–1000000 的整数',
              },
            ]}
            extra="严格超过此数量才触发。例如阈值为 10，至少 11 个异常变体才会电话加急。"
          />
          <ProFormDigit
            name={fieldName('cooldownMinutes')}
            label="电话加急冷却时间（分钟）"
            min={5}
            max={10080}
            fieldProps={{ precision: 0 }}
            rules={[
              { required: true, message: '请输入冷却时间' },
              {
                type: 'integer',
                min: 5,
                max: 10080,
                message: '冷却时间须为 5–10080 的整数',
              },
            ]}
            extra="每个区域独立计时；冷却结束后，若再次判断仍超过阈值，将再次通知。"
          />
          <ProFormSelect
            name={fieldName('userIds')}
            label="电话加急联系人（open_id）"
            placeholder="输入 ou_ 开头的 open_id，按回车添加"
            fieldProps={{
              mode: 'tags',
              tokenSeparators: [',', '，', ' ', '\n'],
              open: false,
            }}
            rules={[
              {
                validator(_, values: string[] | undefined) {
                  if (!values?.length) {
                    return Promise.reject(new Error('请至少填写一位联系人'));
                  }
                  if (values.length > 10) {
                    return Promise.reject(new Error('最多填写 10 位联系人'));
                  }
                  if (!values.every(validContact)) {
                    return Promise.reject(
                      new Error('请填写有效的 open_id（以 ou_ 开头）'),
                    );
                  }
                  if (new Set(values).size !== values.length) {
                    return Promise.reject(new Error('联系人不能重复'));
                  }
                  return Promise.resolve();
                },
              },
            ]}
            extra="最多 10 人。请填写该飞书应用下的联系人 open_id，不是手机号。"
          />
          <Alert
            type="info"
            showIcon
            message="飞书应用配置"
            description="需在服务端配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET，为应用机器人开通发送消息及电话加急权限，并确保联系人在应用可用范围内。普通群 Webhook 仍用于群通知；电话加急通过应用机器人发送。"
            style={{ marginBottom: 16 }}
          />
        </>
      )}
    </>
  );
};

export default FeishuEmergencyFields;
