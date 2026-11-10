const { createHash } = require('node:crypto');
const axios = require('axios');
const logger = require('../utils/logger');

const FEISHU_ORIGIN = 'https://open.feishu.cn';
const REQUEST_TIMEOUT_MS = 10000;
const MAX_RECIPIENTS = 10;

function apiUrl(path, params = {}) {
  const url = new URL(path, FEISHU_ORIGIN);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function successfulResponse(response) {
  return response?.status === 200 && response?.data?.code === 0;
}

// External error messages can contain credentials or recipient IDs.
function logFailure(stage, response) {
  logger.error('[feishu-urgent] 飞书电话加急请求失败', {
    stage,
    ...(Number.isInteger(response?.status) ? { status: response.status } : {}),
    ...(Number.isInteger(response?.data?.code)
      ? { code: response.data.code }
      : {}),
  });
}

/**
 * Send a bot direct message to each recipient, then urgently call that recipient.
 * `success` means every recipient's phone request was accepted by Feishu.
 * The caller supplies a stable requestId and controls the alert cooldown.
 */
async function sendUrgentPhoneNotifications(options = {}) {
  const { userIds, text, requestId } = options || {};
  const recipients = Array.isArray(userIds)
    ? [
        ...new Set(
          userIds.map((id) => (typeof id === 'string' ? id.trim() : '')),
        ),
      ]
    : [];
  const failedResult = { success: false, sent: 0, failed: recipients.length };

  if (
    recipients.length === 0 ||
    recipients.length > MAX_RECIPIENTS ||
    recipients.some((id) => !id) ||
    typeof text !== 'string' ||
    !text.trim() ||
    typeof requestId !== 'string' ||
    !requestId.trim()
  ) {
    logger.warn('[feishu-urgent] 电话加急参数无效，跳过发送');
    return failedResult;
  }

  const appId = process.env.FEISHU_APP_ID?.trim();
  const appSecret = process.env.FEISHU_APP_SECRET?.trim();
  if (!appId || !appSecret) {
    logger.warn('[feishu-urgent] 未配置飞书应用凭据，跳过电话加急');
    return failedResult;
  }

  let tenantToken;
  try {
    const response = await axios.post(
      apiUrl('/open-apis/auth/v3/tenant_access_token/internal'),
      { app_id: appId, app_secret: appSecret },
      {
        timeout: REQUEST_TIMEOUT_MS,
        maxRedirects: 0,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      },
    );
    tenantToken = response?.data?.tenant_access_token;
    if (
      !successfulResponse(response) ||
      typeof tenantToken !== 'string' ||
      !tenantToken.trim()
    ) {
      logFailure('authentication', response);
      return failedResult;
    }
  } catch (error) {
    logFailure('authentication', error?.response);
    return failedResult;
  }

  const requestOptions = {
    timeout: REQUEST_TIMEOUT_MS,
    maxRedirects: 0,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${tenantToken}`,
    },
  };

  const outcomes = await Promise.all(
    recipients.map(async (recipient) => {
      let stage = 'message';
      try {
        const uuid = createHash('sha256')
          .update(JSON.stringify([requestId, recipient]))
          .digest('hex')
          .slice(0, 40);
        const response = await axios.post(
          apiUrl('/open-apis/im/v1/messages', { receive_id_type: 'open_id' }),
          {
            receive_id: recipient,
            msg_type: 'text',
            content: JSON.stringify({ text }),
            uuid,
          },
          requestOptions,
        );
        const messageId = response?.data?.data?.message_id;
        if (
          !successfulResponse(response) ||
          typeof messageId !== 'string' ||
          !messageId.trim()
        ) {
          logFailure(stage, response);
          return false;
        }

        stage = 'urgent_phone';
        const urgentResponse = await axios.patch(
          apiUrl(
            `/open-apis/im/v1/messages/${encodeURIComponent(
              messageId,
            )}/urgent_phone`,
            { user_id_type: 'open_id' },
          ),
          { user_id_list: [recipient] },
          requestOptions,
        );
        const invalidIds = urgentResponse?.data?.data?.invalid_user_id_list;
        if (
          !successfulResponse(urgentResponse) ||
          (invalidIds !== undefined &&
            (!Array.isArray(invalidIds) || invalidIds.length > 0))
        ) {
          logFailure(stage, urgentResponse);
          return false;
        }
        return true;
      } catch (error) {
        // A timeout may have reached Feishu; do not retry a phone request here.
        logFailure(stage, error?.response);
        return false;
      }
    }),
  );

  const sent = outcomes.filter(Boolean).length;
  const result = {
    success: sent === recipients.length,
    sent,
    failed: recipients.length - sent,
  };
  logger.info('[feishu-urgent] 飞书电话加急发送完成', {
    sent: result.sent,
    failed: result.failed,
  });
  return result;
}

module.exports = { sendUrgentPhoneNotifications };
