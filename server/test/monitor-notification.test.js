process.env.LOG_LEVEL = 'ERROR';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  sendCountryMonitorNotification,
} = require('../src/services/monitorCountryNotification');

test('国家检查完成后发送飞书并标记该国异常历史', async () => {
  const calls = [];
  const notifyResults = {
    total: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    countryResults: {},
  };

  await sendCountryMonitorNotification({
    country: 'DE',
    countryResults: { DE: { country: 'DE', brokenGroups: 1 } },
    countryCheckRanges: {
      DE: {
        startTime: new Date('2026-10-17T08:00:00.000Z'),
        endTime: new Date('2026-10-17T08:05:00.000Z'),
      },
    },
    checkTime: new Date('2026-10-17T08:00:00.000Z'),
    notifyResults,
    sendNotification: async (country, result) => {
      calls.push(['notify', country, result.brokenGroups]);
      return { success: true, skipped: false };
    },
    monitorHistory: {
      updateNotificationStatusByRange: async (
        country,
        startTime,
        endTime,
        notificationSent,
      ) => {
        calls.push([
          'history',
          country,
          startTime.toISOString(),
          endTime.toISOString(),
          notificationSent,
        ]);
        return 1;
      },
      updateNotificationStatus: async () => 0,
    },
    logger: { info() {}, warn() {}, error() {} },
  });

  assert.deepEqual(calls, [
    ['notify', 'DE', 1],
    [
      'history',
      'DE',
      '2026-10-17T08:00:00.000Z',
      '2026-10-17T08:05:00.000Z',
      1,
    ],
  ]);
  assert.deepEqual(notifyResults.countryResults.DE, {
    success: true,
    skipped: false,
  });
});
