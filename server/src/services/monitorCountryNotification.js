async function sendCountryMonitorNotification({
  country,
  countryResults,
  countryCheckRanges,
  checkTime,
  notifyResults,
  sendNotification,
  monitorHistory,
  logger,
}) {
  logger.info(`\n📨 开始发送 ${country} 的飞书通知...`);
  const countryNotifyResult = await sendNotification(
    country,
    countryResults[country],
  );
  notifyResults.total++;
  if (countryNotifyResult.success) {
    notifyResults.success++;
    notifyResults.countryResults[country] = countryNotifyResult;
    logger.info(`✅ ${country} 的飞书通知发送成功`);
  } else {
    notifyResults.failed++;
    notifyResults.countryResults[country] = countryNotifyResult;
    logger.warn(
      `❌ ${country} 的飞书通知发送失败${
        countryNotifyResult.errorCode
          ? ` (错误码: ${countryNotifyResult.errorCode})`
          : ''
      }`,
    );
  }

  if (
    countryNotifyResult.success &&
    !countryNotifyResult.skipped &&
    countryResults[country] &&
    countryResults[country].brokenGroups > 0
  ) {
    try {
      const checkTimeRange = countryCheckRanges[country];
      const updatedCount =
        checkTimeRange?.startTime && checkTimeRange?.endTime
          ? await monitorHistory.updateNotificationStatusByRange(
              country,
              checkTimeRange.startTime,
              checkTimeRange.endTime,
              1,
            )
          : await monitorHistory.updateNotificationStatus(
              country,
              checkTime,
              1,
            );
      if (updatedCount > 0) {
        logger.info(
          `✅ 已更新 ${country} 的 ${updatedCount} 条监控历史记录为已通知状态`,
        );
      }
    } catch (error) {
      logger.error(
        `❌ 更新 ${country} 监控历史记录通知状态失败:`,
        error.message,
      );
    }
  }

  return countryNotifyResult;
}

module.exports = {
  sendCountryMonitorNotification,
};
