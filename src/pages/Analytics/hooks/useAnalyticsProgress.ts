import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildProgressText,
  updateProgressProfileEntry,
  type ProgressRuntimeSnapshot,
} from '../analyticsProgressUtils';
import { readProgressProfile, writeProgressProfile } from '../helpers';
import type { ProgressProfile } from '../types';

type ProgressProfileEntry = ProgressProfile[string];

export type ProgressTask<T = unknown> = {
  label: string;
  run: () => Promise<T>;
  updateProfile?: (context: {
    duration: number;
    previousProfile: ProgressProfileEntry;
    result: T;
  }) => Partial<ProgressProfileEntry> | void;
};

const useAnalyticsProgress = () => {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const progressTimerRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const activeRunIdRef = useRef(0);

  const clearProgressTimer = useCallback(() => {
    if (progressTimerRef.current) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }, []);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const scheduleRetry = useCallback(
    (callback: () => void, delay: number) => {
      clearRetryTimer();
      retryTimerRef.current = window.setTimeout(callback, delay);
    },
    [clearRetryTimer],
  );

  const runTasksWithProgress = useCallback(
    async <T>(
      tasks: Array<ProgressTask<T>>,
      options?: {
        maxConcurrency?: number;
      },
    ) => {
      const runId = activeRunIdRef.current + 1;
      activeRunIdRef.current = runId;
      setLoading(true);
      setProgress(0);
      setProgressText('');
      clearProgressTimer();

      try {
        const startedAt = Date.now();
        const progressProfile: ProgressProfile = readProgressProfile();
        const taskDurationAvg: Record<string, number> = {};
        const taskStartTimes: Record<string, number> = {};
        let completedCount = 0;
        let runningLabels = tasks.map((task) => task.label);
        let lastCompleted: { label: string; failed?: boolean } | null = null;

        const isActiveRun = () => activeRunIdRef.current === runId;
        const getProgressSnapshot = (): ProgressRuntimeSnapshot => ({
          completed: completedCount,
          lastCompleted,
          progressProfile,
          runningLabels,
          taskDurationAvg,
          taskStartTimes,
          total: tasks.length,
        });

        const updateProgressText = () => {
          if (!isActiveRun()) {
            return;
          }
          setProgressText(buildProgressText(getProgressSnapshot(), startedAt));
        };

        tasks.forEach((task) => {
          const cached = progressProfile[task.label];
          if (cached?.avgDurationMs) {
            taskDurationAvg[task.label] = cached.avgDurationMs;
          }
        });
        const now = Date.now();
        tasks.forEach((task) => {
          taskStartTimes[task.label] = now;
        });
        updateProgressText();
        if (isActiveRun()) {
          progressTimerRef.current = window.setInterval(() => {
            updateProgressText();
          }, 300);
        }

        const updateTaskMetrics = (
          label: string,
          duration: number,
          updateProfile?: Partial<ProgressProfileEntry>,
        ) => {
          updateProgressProfileEntry(
            progressProfile,
            taskDurationAvg,
            label,
            duration,
            updateProfile,
          );
          writeProgressProfile(progressProfile);
        };

        const runTaskWithProgress = async (task: ProgressTask<T>) => {
          const { label, run, updateProfile } = task;
          taskStartTimes[label] = Date.now();
          return run()
            .then((result) => {
              completedCount += 1;
              runningLabels = runningLabels.filter((item) => item !== label);
              lastCompleted = { label, failed: false };
              const taskStartTime = taskStartTimes[label];
              if (taskStartTime) {
                const duration = Math.max(0, Date.now() - taskStartTime);
                const previousProfile = progressProfile[label] || {};
                const profileUpdate =
                  updateProfile?.({
                    duration,
                    previousProfile,
                    result,
                  }) ?? undefined;
                updateTaskMetrics(label, duration, profileUpdate);
              }
              if (isActiveRun()) {
                setProgress(
                  Math.round(
                    (completedCount / Math.max(tasks.length, 1)) * 100,
                  ),
                );
              }
              updateProgressText();
              return result;
            })
            .catch((error) => {
              completedCount += 1;
              runningLabels = runningLabels.filter((item) => item !== label);
              lastCompleted = { label, failed: true };
              const taskStartTime = taskStartTimes[label];
              if (taskStartTime) {
                const duration = Math.max(0, Date.now() - taskStartTime);
                updateTaskMetrics(label, duration);
              }
              if (isActiveRun()) {
                setProgress(
                  Math.round(
                    (completedCount / Math.max(tasks.length, 1)) * 100,
                  ),
                );
              }
              updateProgressText();
              throw error;
            });
        };

        const maxConcurrency = Math.max(
          1,
          Math.min(options?.maxConcurrency || 3, tasks.length || 1),
        );
        const results: PromiseSettledResult<T>[] = new Array(tasks.length);
        let taskCursor = 0;

        const workers = Array.from(
          { length: Math.min(maxConcurrency, tasks.length) },
          async () => {
            while (true) {
              const currentIndex = taskCursor;
              taskCursor += 1;
              if (currentIndex >= tasks.length) {
                return;
              }

              try {
                const value = await runTaskWithProgress(tasks[currentIndex]);
                results[currentIndex] = { status: 'fulfilled', value };
              } catch (reason) {
                results[currentIndex] = { status: 'rejected', reason };
              }
            }
          },
        );

        await Promise.all(workers);
        return results;
      } finally {
        if (activeRunIdRef.current === runId) {
          setLoading(false);
          setProgress(0);
          setProgressText('');
          clearProgressTimer();
        }
      }
    },
    [clearProgressTimer],
  );

  useEffect(() => {
    return () => {
      clearProgressTimer();
      clearRetryTimer();
    };
  }, [clearProgressTimer, clearRetryTimer]);

  return {
    clearRetryTimer,
    loading,
    progress,
    progressText,
    runTasksWithProgress,
    scheduleRetry,
  };
};

export default useAnalyticsProgress;
