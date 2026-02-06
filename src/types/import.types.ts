export interface ImportRow {
  rowNumber: number;
  data: Record<string, any>;
  isValid: boolean;
  errors: ValidationError[];
  savedAt?: Date;
  saveError?: string;
}

export interface ValidationError {
  field: string;
  message: string;
  value?: any;
}

export interface ValidationRule {
  field: string;
  required?: boolean;
  type?: 'string' | 'number' | 'email' | 'date' | 'boolean';
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  custom?: (value: any, row: Record<string, any>) => string | null;
}

export interface ImportResult {
  importId: string;
  fileName: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  rows: ImportRow[];
  summary: ImportSummary;
  createdAt: Date;
}

export interface ImportSummary {
  totalProcessed: number;
  successCount: number;
  errorCount: number;
  errorsByField: Record<string, number>;
}

export type JobStatus = 
  | 'pending'
  | 'queued'
  | 'parsing'
  | 'validating'
  | 'validated'
  | 'saving'
  | 'completed'
  | 'partial_success'
  | 'failed'
  | 'cancelled';

export type SaveMode = 'partial' | 'transactional';

export interface ImportJob {
  id: string;
  fileName: string;
  status: JobStatus;
  phase: string;
  progress: number;
  totalRows: number;
  processedRows: number;
  validRows: number;
  invalidRows: number;
  savedRows: number;
  failedSaveRows: number;
  saveMode: SaveMode;
  validationRules: ValidationRule[];
  result?: ImportResult;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface ImportOptions {
  dryRun?: boolean;
  validationRules?: ValidationRule[];
  skipHeader?: boolean;
  sheetName?: string;
  saveMode?: SaveMode;
  chunkSize?: number;
}

export interface ParsedFile {
  headers: string[];
  rows: Record<string, any>[];
  fileName: string;
  rowCount: number;
}

export interface SaveResult {
  savedCount: number;
  failedCount: number;
  savedRows: ImportRow[];
  failedRows: ImportRow[];
  mode: SaveMode;
  rolledBack: boolean;
}

export interface ChunkValidationResult {
  chunkIndex: number;
  rows: ImportRow[];
  validCount: number;
  invalidCount: number;
}
