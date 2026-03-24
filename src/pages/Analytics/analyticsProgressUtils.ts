import { formatDuration } from './helpers';
import type { ProgressProfile } from './types';

type ProgressProfileEntry = ProgressProfile[string];
const EXCEEDED_ESTIMATE = -1;

export type ProgressRuntimeSnapshot = {
  completed: number;
  lastCompleted: { label: string; failed?: boolean } | null;
  progressProfile: ProgressProfile;
  runningLabels: string[];
  taskDurationAvg: Record<string, number>;
  taskStartTimes: Record<string, number>;
  total: number;
};

export const estimateRemainingMs = (
  snapshot: ProgressRuntimeSnapshot,
  startTimeMs: number | null,
) => {
  const {
    completed,
    progressProfile,
    runningLabels,
    taskDurationAvg,
    taskStartTimes,
    total,
  } = snapshot;

  if (runningLabels.length === 0) {
    return 0;
  }

  const now = Date.now();
  const throughputPerTask =
    completed > 0 && startTimeMs ? (now - startTimeMs) / completed : null;
  const completedAverages = Object.values(taskDurationAvg).filter(
    (value) => Number.isFinite(value) && value > 0,
  );
  const globalAvg =
    completedAverages.length > 0
      ? completedAverages.reduce((sum, value) => sum + value, 0) /
        completedAverages.length
      : null;
  const estimateByThroughput =
    completed > 0 && total > completed && throughputPerTask
      ? throughputPerTask * (total - completed)
      : null;
  let maxRemaining = 0;
  let hasEstimate = false;
  let allRunningTasksExceededEstimate = true;

  for (const label of runningLabels) {
    const taskStartTime = taskStartTimes[label];
    const elapsedMs = taskStartTime ? now - taskStartTime : 0;
    const profile = progressProfile[label];
    const estimateByTotal =
      profile?.avgPerItemMs && profile?.lastTotal
        ? profile.avgPerItemMs * profile.lastTotal
        : null;
    const estimate =
      estimateByTotal ||
      taskDurationAvg[label] ||
      profile?.avgDurationMs ||
      globalAvg ||
      throughputPerTask;

    if (!estimate) {
      return null;
    }

    hasEstimate = true;
    if (elapsedMs < estimate) {
      allRunningTasksExceededEstimate = false;
    }

    const minRemaining = Math.min(Math.max(estimate * 0.1, 1000), 5000);
    const remaining = Math.max(estimate - elapsedMs, minRemaining);
    if (remaining > maxRemaining) {
      maxRemaining = remaining;
    }
  }

  if (hasEstimate && allRunningTasksExceededEstimate) {
    return EXCEEDED_ESTIMATE;
  }

  if (estimateByThroughput) {
    return Math.round(maxRemaining * 0.6 + estimateByThroughput * 0.4);
  }

  return maxRemaining;
};

export const buildTimeMeta = (
  snapshot: ProgressRuntimeSnapshot,
  startTimeMs: number | null,
) => {
  if (!startTimeMs) {
    return '';
  }

  const elapsedMs = Date.now() - startTimeMs;
  const elapsedText = formatDuration(elapsedMs);
  const remainingMs = estimateRemainingMs(snapshot, startTimeMs);
  if (remainingMs === EXCEEDED_ESTIMATE) {
    return `已用时 ${elapsedText} · 已超过预计时长`;
  }
  const remainingText =
    remainingMs === null ? '--' : formatDuration(remainingMs);
  return `已用时 ${elapsedText} · 预计剩余 ${remainingText}`;
};

export const buildStatusText = (snapshot: ProgressRuntimeSnapshot) => {
  const { completed, lastCompleted, runningLabels, total } = snapshot;
  let statusDetail = '准备开始';

  if (runningLabels.length > 0) {
    const activeLabel = runningLabels[0];
    statusDetail =
      runningLabels.length > 1
        ? `正在处理：${activeLabel} 等${runningLabels.length}项`
        : `正在处理：${activeLabel}`;
  } else if (lastCompleted?.label) {
    statusDetail = `最近完成：${lastCompleted.label}${
      lastCompleted.failed ? '（失败）' : ''
    }`;
  }

  return `加载统计中 · 已完成 ${completed}/${total} · ${statusDetail}`;
};

export const buildProgressText = (
  snapshot: ProgressRuntimeSnapshot,
  startTimeMs: number | null,
) => `${buildStatusText(snapshot)}\n${buildTimeMeta(snapshot, startTimeMs)}`;

export const updateProgressProfileEntry = (
  profile: ProgressProfile,
  taskDurationAvg: Record<string, number>,
  label: string,
  duration: number,
  profileUpdate?: Partial<ProgressProfileEntry>,
) => {
  const previousAvg = taskDurationAvg[label];
  taskDurationAvg[label] = previousAvg
    ? Math.round(previousAvg * 0.7 + duration * 0.3)
    : duration;

  const entry = profile[label] || {};
  entry.avgDurationMs = taskDurationAvg[label];
  Object.assign(entry, profileUpdate);
  profile[label] = entry;
};
