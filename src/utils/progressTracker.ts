import { EventEmitter } from 'events';

export interface ProgressUpdate {
  jobId: string;
  phase: 'uploading' | 'queued' | 'parsing' | 'validating' | 'validated' | 'saving' | 'exporting' | 'completed' | 'partial_success' | 'failed' | 'cancelled';
  progress: number; // 0-100
  currentRow?: number;
  totalRows?: number;
  processedRows?: number;
  validRows?: number;
  invalidRows?: number;
  message?: string;
  error?: string;
  timestamp: Date;
}

export class ProgressTracker extends EventEmitter {
  private static instance: ProgressTracker;
  private progressMap: Map<string, ProgressUpdate> = new Map();

  private constructor() {
    super();
    // Increase max listeners for SSE connections
    this.setMaxListeners(100);
  }

  static getInstance(): ProgressTracker {
    if (!ProgressTracker.instance) {
      ProgressTracker.instance = new ProgressTracker();
    }
    return ProgressTracker.instance;
  }

  /**
   * Update progress for a job
   */
  update(jobId: string, update: Partial<ProgressUpdate>): void {
    const current = this.progressMap.get(jobId) || {
      jobId,
      phase: 'uploading' as const,
      progress: 0,
      timestamp: new Date(),
    };

    const newProgress: ProgressUpdate = {
      ...current,
      ...update,
      jobId,
      timestamp: new Date(),
    };

    this.progressMap.set(jobId, newProgress);
    this.emit('progress', newProgress);
    this.emit(`progress:${jobId}`, newProgress);
  }

  /**
   * Get current progress for a job
   */
  getProgress(jobId: string): ProgressUpdate | null {
    return this.progressMap.get(jobId) || null;
  }

  /**
   * Initialize tracking for a new job
   */
  startTracking(jobId: string, totalRows?: number): void {
    this.update(jobId, {
      phase: 'parsing',
      progress: 0,
      totalRows,
      processedRows: 0,
      validRows: 0,
      invalidRows: 0,
      message: 'Starting import process...',
    });
  }

  /**
   * Mark job as completed
   */
  complete(jobId: string, summary: { validRows: number; invalidRows: number; totalRows: number }): void {
    this.update(jobId, {
      phase: 'completed',
      progress: 100,
      ...summary,
      processedRows: summary.totalRows,
      message: `Import completed: ${summary.validRows} valid, ${summary.invalidRows} invalid`,
    });
  }

  /**
   * Mark job as failed
   */
  fail(jobId: string, error: string): void {
    this.update(jobId, {
      phase: 'failed',
      error,
      message: `Import failed: ${error}`,
    });
  }

  /**
   * Clean up job tracking
   */
  cleanup(jobId: string): void {
    this.progressMap.delete(jobId);
    this.removeAllListeners(`progress:${jobId}`);
  }

  /**
   * Get all active jobs
   */
  getAllJobs(): ProgressUpdate[] {
    return Array.from(this.progressMap.values());
  }
}

export const progressTracker = ProgressTracker.getInstance();
