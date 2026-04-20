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
  const progressStartRef = useRef<number | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const completedCountRef = useRef(0);
  const totalPromisesRef = useRef(0);
  const runningLabelsRef = useRef<string[]>([]);
  const lastCompletedRef = useRef<{ label: string; failed?: boolean } | null>(
    null,
  );
  const taskStartTimesRef = useRef<Record<string, number>>({});
  const taskDurationAvgRef = useRef<Record<string, number>>({});
  const progressProfileRef = useRef<ProgressProfile>({});

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
    async <T>(tasks: Array<ProgressTask<T>>) => {
      setLoading(true);
      setProgress(0);
      setProgressText('');
      progressStartRef.current = Date.now();
      completedCountRef.current = 0;
      totalPromisesRef.current = 0;
      runningLabelsRef.current = [];
      lastCompletedRef.current = null;
      taskStartTimesRef.current = {};
      progressProfileRef.current = readProgressProfile();
      taskDurationAvgRef.current = {};
      clearProgressTimer();

      try {
        const getProgressSnapshot = (): ProgressRuntimeSnapshot => ({
          completed: completedCountRef.current,
          lastCompleted: lastCompletedRef.current,
          progressProfile: progressProfileRef.current,
          runningLabels: runningLabelsRef.current,
          taskDurationAvg: taskDurationAvgRef.current,
          taskStartTimes: taskStartTimesRef.current,
          total: totalPromisesRef.current,
        });

        const updateProgressText = () => {
          setProgressText(
            buildProgressText(getProgressSnapshot(), progressStartRef.current),
          );
        };

        const totalPromises = tasks.length;
        let completedCount = 0;
        totalPromisesRef.current = totalPromises;
        completedCountRef.current = 0;
        tasks.forEach((task) => {
          const cached = progressProfileRef.current[task.label];
          if (cached?.avgDurationMs) {
            taskDurationAvgRef.current[task.label] = cached.avgDurationMs;
          }
        });
        runningLabelsRef.current = tasks.map((task) => task.label);
        const taskStartTimes: Record<string, number> = {};
        const now = Date.now();
        tasks.forEach((task) => {
          taskStartTimes[task.label] = now;
        });
        taskStartTimesRef.current = taskStartTimes;
        updateProgressText();
        progressTimerRef.current = window.setInterval(() => {
          updateProgressText();
        }, 300);

        const updateTaskMetrics = (
          label: string,
          duration: number,
          updateProfile?: Partial<ProgressProfileEntry>,
        ) => {
          updateProgressProfileEntry(
            progressProfileRef.current,
            taskDurationAvgRef.current,
            label,
            duration,
            updateProfile,
          );
          writeProgressProfile(progressProfileRef.current);
        };

        const runTaskWithProgress = async (task: ProgressTask<T>) => {
          const { label, run, updateProfile } = task;
          taskStartTimesRef.current[label] = Date.now();
          return run()
            .then((result) => {
              completedCount += 1;
              const newProgress = Math.round(
                (completedCount / totalPromises) * 100,
              );
              setProgress(newProgress);
              completedCountRef.current = completedCount;
              runningLabelsRef.current = runningLabelsRef.current.filter(
                (item) => item !== label,
              );
              lastCompletedRef.current = { label, failed: false };
              const taskStartTime = taskStartTimesRef.current[label];
              if (taskStartTime) {
                const duration = Math.max(0, Date.now() - taskStartTime);
                const previousProfile = progressProfileRef.current[label] || {};
                const profileUpdate =
                  updateProfile?.({
                    duration,
                    previousProfile,
                    result,
                  }) ?? undefined;
                updateTaskMetrics(label, duration, profileUpdate);
              }
              updateProgressText();
              return result;
            })
            .catch((error) => {
              completedCount += 1;
              const newProgress = Math.round(
                (completedCount / totalPromises) * 100,
              );
              setProgress(newProgress);
              completedCountRef.current = completedCount;
              runningLabelsRef.current = runningLabelsRef.current.filter(
                (item) => item !== label,
              );
              lastCompletedRef.current = { label, failed: true };
              const taskStartTime = taskStartTimesRef.current[label];
              if (taskStartTime) {
                const duration = Math.max(0, Date.now() - taskStartTime);
                updateTaskMetrics(label, duration);
              }
              updateProgressText();
              throw error;
            });
        };

        const maxConcurrency = 3;
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
        setLoading(false);
        setProgress(0);
        setProgressText('');
        progressStartRef.current = null;
        clearProgressTimer();
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
