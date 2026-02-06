export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
  timestamp: Date;
}

export interface PaginatedResponse<T = any> extends ApiResponse<T> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface UploadResponse {
  importId: string;
  fileName: string;
  rowCount: number;
  headers: string[];
  previewRows: Record<string, any>[];
}

export interface ValidationResponse {
  importId: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: {
    rowNumber: number;
    errors: { field: string; message: string }[];
  }[];
  isValid: boolean;
}

export interface SaveResponse {
  importId: string;
  savedCount: number;
  failedCount: number;
  message: string;
  mode?: string;
  rolledBack?: boolean;
}

export interface JobStatusResponse {
  jobId: string;
  status: string;
  phase: string;
  progress: number;
  totalRows: number;
  processedRows: number;
  validRows: number;
  invalidRows: number;
  savedRows?: number;
  failedSaveRows?: number;
  saveMode?: string;
  result?: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
  };
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  updatedAt: Date;
}

export interface ProgressEvent {
  type: 'connected' | 'progress' | 'complete';
  jobId: string;
  phase?: string;
  progress?: number;
  currentRow?: number;
  totalRows?: number;
  processedRows?: number;
  validRows?: number;
  invalidRows?: number;
  message?: string;
  error?: string;
  timestamp?: Date;
}
