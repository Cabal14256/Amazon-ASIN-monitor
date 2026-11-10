export interface ImportPreviewSummary {
  total: number;
  processedCount?: number;
  createdCount: number;
  updatedCount: number;
  movedCount: number;
  unchangedCount: number;
  failedCount: number;
  createdGroupCount: number;
  updatedGroupCount: number;
  groupOnlyCount: number;
  verificationPassed?: boolean;
}

export type ImportPreviewAction =
  | 'create'
  | 'update'
  | 'move'
  | 'unchanged'
  | 'skipped'
  | 'group-create'
  | 'group-update';

export interface ImportPreviewRow {
  row: number;
  action: ImportPreviewAction;
  asin?: string;
  country?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  changes?: Record<string, unknown> | unknown[] | null;
  groupChanges?: Record<string, unknown> | unknown[] | null;
  error?: string | null;
}

export interface ImportPreviewPage {
  previewId: string;
  expiresAt: string;
  summary: ImportPreviewSummary;
  rows: ImportPreviewRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages?: number;
  };
}

export type ImportPreviewResponse = {
  success: boolean;
  errorMessage?: string;
  data?: ImportPreviewPage;
};

export type ImportConfirmResponse = {
  success: boolean;
  errorMessage?: string;
  data?: { taskId: string; status?: string };
};
