import type { ProgressProfile } from './types';

const PROGRESS_PROFILE_KEY = 'analyticsProgressProfile.v1';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const readProgressProfile = (): ProgressProfile => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(PROGRESS_PROFILE_KEY);
    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return {};
    }

    return parsed as ProgressProfile;
  } catch {
    return {};
  }
};

export const writeProgressProfile = (profile: ProgressProfile) => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(PROGRESS_PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Ignore write failures.
  }
};
