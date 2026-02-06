import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { FileParser } from '../../utils/fileParser';
import { StreamParser } from '../../utils/streamParser';
import { Validators } from '../../utils/validators';
import { progressTracker, ProgressUpdate } from '../../utils/progressTracker';
import {
  ImportRow,
  ImportResult,
  ImportOptions,
  ValidationRule,
  ParsedFile,
  ImportSummary,
  ImportJob,
  JobStatus,
  SaveMode,
  SaveResult,
  ChunkValidationResult,
} from '../../types/import.types';
import { config } from '../../config';

// In-memory stores (replace with database in production)
const importStore: Map<string, ImportResult> = new Map();
const jobStore: Map<string, ImportJob> = new Map();
const chunkStore: Map<string, ImportRow[]> = new Map(); // Store validated chunks

export class ImportService {
  /**
   * Upload and parse a file, returning preview data
   */
  async uploadAndParse(filePath: string, options: ImportOptions = {}): Promise<{
    importId: string;
    parsed: ParsedFile;
    preview: Record<string, any>[];
    totalRows: number;
  }> {
    const importId = uuidv4();
    
    // Get row count first for progress tracking
    const totalRows = await StreamParser.getRowCount(filePath);
    
    // Parse with preview limit
    const parsed = FileParser.parsePreview(filePath, config.validation.maxRowsPreview, options.sheetName);
    
    return {
      importId,
      parsed: { ...parsed, rowCount: totalRows },
      preview: parsed.rows,
      totalRows,
    };
  }

  /**
   * Validate all rows with streaming support and progress tracking
   */
  async validateStream(
    importId: string,
    filePath: string,
    rules: ValidationRule[],
    options: { sheetName?: string; chunkSize?: number } = {}
  ): Promise<ImportResult> {
    const { chunkSize = 100 } = options;
    const allRows: ImportRow[] = [];
    let validCount = 0;
    let invalidCount = 0;
    const errorsByField: Record<string, number> = {};
    let fileName = '';

    progressTracker.update(importId, {
      phase: 'validating',
      progress: 0,
      message: 'Starting validation...',
    });

    await StreamParser.parseStream(filePath, {
      chunkSize,
      sheetName: options.sheetName,
      onHeader: (headers) => {
        progressTracker.update(importId, {
          message: `Found ${headers.length} columns`,
        });
      },
      onChunk: async (chunkRows, chunkIndex) => {
        const validatedChunk = this.validateChunk(chunkRows, rules, chunkIndex * chunkSize);
        
        validatedChunk.rows.forEach((row) => {
          allRows.push(row);
          if (row.isValid) {
            validCount++;
          } else {
            invalidCount++;
            row.errors.forEach((err) => {
              errorsByField[err.field] = (errorsByField[err.field] || 0) + 1;
            });
          }
        });

        // Store validated chunks for later retrieval
        const existingChunks = chunkStore.get(importId) || [];
        chunkStore.set(importId, [...existingChunks, ...validatedChunk.rows]);
      },
      onProgress: (processed, total) => {
        const progress = Math.round((processed / total) * 100);
        progressTracker.update(importId, {
          phase: 'validating',
          progress,
          processedRows: processed,
          totalRows: total,
          validRows: validCount,
          invalidRows: invalidCount,
          message: `Validated ${processed} of ${total} rows`,
        });
      },
    }).then((parsed) => {
      fileName = parsed.fileName;
    });

    const result: ImportResult = {
      importId,
      fileName,
      totalRows: allRows.length,
      validRows: validCount,
      invalidRows: invalidCount,
      rows: allRows,
      summary: {
        totalProcessed: allRows.length,
        successCount: validCount,
        errorCount: invalidCount,
        errorsByField,
      },
      createdAt: new Date(),
    };

    importStore.set(importId, result);

    progressTracker.update(importId, {
      phase: 'validated',
      progress: 100,
      processedRows: allRows.length,
      totalRows: allRows.length,
      validRows: validCount,
      invalidRows: invalidCount,
      message: `Validation complete: ${validCount} valid, ${invalidCount} invalid`,
    });

    return result;
  }

  /**
   * Validate a single chunk of rows
   */
  private validateChunk(
    rows: Record<string, any>[],
    rules: ValidationRule[],
    startRowNumber: number
  ): ChunkValidationResult {
    const validatedRows: ImportRow[] = [];
    let validCount = 0;
    let invalidCount = 0;

    rows.forEach((rowData, index) => {
      const errors = Validators.validateRow(rowData, rules);
      const isValid = errors.length === 0;

      if (isValid) validCount++;
      else invalidCount++;

      validatedRows.push({
        rowNumber: startRowNumber + index + 1,
        data: rowData,
        isValid,
        errors,
      });
    });

    return {
      chunkIndex: Math.floor(startRowNumber / rows.length),
      rows: validatedRows,
      validCount,
      invalidCount,
    };
  }

  /**
   * Validate all rows in the parsed data (legacy sync method)
   */
  async validate(
    importId: string,
    parsedData: ParsedFile,
    rules: ValidationRule[]
  ): Promise<ImportResult> {
    const rows: ImportRow[] = [];
    let validCount = 0;
    let invalidCount = 0;
    const errorsByField: Record<string, number> = {};

    for (let i = 0; i < parsedData.rows.length; i++) {
      const rowData = parsedData.rows[i];
      const errors = Validators.validateRow(rowData, rules);

      const isValid = errors.length === 0;
      if (isValid) {
        validCount++;
      } else {
        invalidCount++;
        errors.forEach((err) => {
          errorsByField[err.field] = (errorsByField[err.field] || 0) + 1;
        });
      }

      rows.push({
        rowNumber: i + 1,
        data: rowData,
        isValid,
        errors,
      });
    }

    const result: ImportResult = {
      importId,
      fileName: parsedData.fileName,
      totalRows: parsedData.rowCount,
      validRows: validCount,
      invalidRows: invalidCount,
      rows,
      summary: {
        totalProcessed: parsedData.rowCount,
        successCount: validCount,
        errorCount: invalidCount,
        errorsByField,
      },
      createdAt: new Date(),
    };

    importStore.set(importId, result);
    return result;
  }

  /**
   * Get validation result by import ID
   */
  async getValidationResult(importId: string): Promise<ImportResult | null> {
    return importStore.get(importId) || null;
  }

  /**
   * Save valid rows with partial success or transactional mode
   */
  async save(
    importId: string,
    options: {
      dryRun?: boolean;
      saveMode?: SaveMode;
      onSave?: (row: Record<string, any>) => Promise<void>;
    } = {}
  ): Promise<SaveResult> {
    const { dryRun = false, saveMode = 'partial', onSave } = options;
    
    const result = importStore.get(importId);
    if (!result) {
      throw new Error(`Import with ID ${importId} not found`);
    }

    const validRows = result.rows.filter((r) => r.isValid);
    const invalidRows = result.rows.filter((r) => !r.isValid);

    if (dryRun) {
      return {
        savedCount: validRows.length,
        failedCount: invalidRows.length,
        savedRows: validRows,
        failedRows: invalidRows,
        mode: saveMode,
        rolledBack: false,
      };
    }

    progressTracker.update(importId, {
      phase: 'saving',
      progress: 0,
      message: `Saving rows (${saveMode} mode)...`,
    });

    if (saveMode === 'transactional') {
      return this.saveTransactional(importId, validRows, invalidRows, onSave);
    } else {
      return this.savePartial(importId, validRows, invalidRows, onSave);
    }
  }

  /**
   * Save with partial success - continue even if some rows fail
   */
  private async savePartial(
    importId: string,
    validRows: ImportRow[],
    invalidRows: ImportRow[],
    onSave?: (row: Record<string, any>) => Promise<void>
  ): Promise<SaveResult> {
    const savedRows: ImportRow[] = [];
    const failedRows: ImportRow[] = [...invalidRows];

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      try {
        if (onSave) {
          await onSave(row.data);
        }
        row.savedAt = new Date();
        savedRows.push(row);
      } catch (error) {
        row.saveError = (error as Error).message;
        failedRows.push({
          ...row,
          isValid: false,
          errors: [...row.errors, { field: 'system', message: `Save failed: ${(error as Error).message}` }],
        });
      }

      // Update progress
      const progress = Math.round(((i + 1) / validRows.length) * 100);
      progressTracker.update(importId, {
        phase: 'saving',
        progress,
        message: `Saved ${savedRows.length} of ${validRows.length} rows`,
      });
    }

    progressTracker.update(importId, {
      phase: failedRows.length > invalidRows.length ? 'partial_success' : 'completed',
      progress: 100,
      message: `Save complete: ${savedRows.length} saved, ${failedRows.length} failed`,
    });

    return {
      savedCount: savedRows.length,
      failedCount: failedRows.length,
      savedRows,
      failedRows,
      mode: 'partial',
      rolledBack: false,
    };
  }

  /**
   * Save with transactional mode - rollback all if any fail
   */
  private async saveTransactional(
    importId: string,
    validRows: ImportRow[],
    invalidRows: ImportRow[],
    onSave?: (row: Record<string, any>) => Promise<void>
  ): Promise<SaveResult> {
    const savedRows: ImportRow[] = [];
    let rollbackNeeded = false;
    let failureError = '';

    // In real implementation, this would use database transactions
    // Here we simulate by collecting all saves and potentially rolling back
    const pendingSaves: ImportRow[] = [];

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      try {
        if (onSave) {
          await onSave(row.data);
        }
        row.savedAt = new Date();
        pendingSaves.push(row);

        const progress = Math.round(((i + 1) / validRows.length) * 100);
        progressTracker.update(importId, {
          phase: 'saving',
          progress,
          message: `Processing ${i + 1} of ${validRows.length} rows (transactional)`,
        });
      } catch (error) {
        rollbackNeeded = true;
        failureError = (error as Error).message;
        
        progressTracker.update(importId, {
          phase: 'saving',
          message: `Error at row ${row.rowNumber}, initiating rollback...`,
        });
        break;
      }
    }

    if (rollbackNeeded) {
      // In real implementation, perform actual rollback
      progressTracker.update(importId, {
        phase: 'failed',
        progress: 100,
        message: `Transaction rolled back due to error: ${failureError}`,
        error: failureError,
      });

      return {
        savedCount: 0,
        failedCount: validRows.length + invalidRows.length,
        savedRows: [],
        failedRows: validRows.map((r) => ({
          ...r,
          saveError: 'Transaction rolled back',
        })),
        mode: 'transactional',
        rolledBack: true,
      };
    }

    progressTracker.update(importId, {
      phase: 'completed',
      progress: 100,
      message: `Transaction complete: ${pendingSaves.length} rows saved`,
    });

    return {
      savedCount: pendingSaves.length,
      failedCount: invalidRows.length,
      savedRows: pendingSaves,
      failedRows: invalidRows,
      mode: 'transactional',
      rolledBack: false,
    };
  }

  /**
   * Export failed rows for download
   */
  async exportFailedRows(importId: string, format: 'csv' | 'xlsx' = 'csv'): Promise<string> {
    const result = importStore.get(importId);
    if (!result) {
      throw new Error(`Import with ID ${importId} not found`);
    }

    const failedRows = result.rows.filter((r) => !r.isValid);
    
    const exportData = failedRows.map((row) => ({
      ...row.data,
      _rowNumber: row.rowNumber,
      _errors: row.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
      _saveError: row.saveError || '',
    }));

    const exportDir = path.join(config.uploadDir, 'exports');
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }

    const fileName = `failed_rows_${importId}.${format}`;
    const filePath = path.join(exportDir, fileName);

    if (format === 'csv') {
      FileParser.exportToCsv(exportData, filePath);
    } else {
      FileParser.exportToExcel(exportData, filePath, 'Failed Rows');
    }

    return filePath;
  }

  /**
   * Create a background job for large file processing
   */
  async createBackgroundJob(filePath: string, options: ImportOptions = {}): Promise<ImportJob> {
    const totalRows = await StreamParser.getRowCount(filePath);
    
    const job: ImportJob = {
      id: uuidv4(),
      fileName: path.basename(filePath),
      status: 'pending',
      phase: 'queued',
      progress: 0,
      totalRows,
      processedRows: 0,
      validRows: 0,
      invalidRows: 0,
      savedRows: 0,
      failedSaveRows: 0,
      saveMode: options.saveMode || 'partial',
      validationRules: options.validationRules || [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    jobStore.set(job.id, job);
    progressTracker.startTracking(job.id, totalRows);

    // Start processing in background
    this.processJobInBackground(job.id, filePath, options);

    return job;
  }

  /**
   * Get job status with real-time updates
   */
  async getJobStatus(jobId: string): Promise<ImportJob | null> {
    const job = jobStore.get(jobId);
    if (!job) return null;

    // Merge with live progress
    const liveProgress = progressTracker.getProgress(jobId);
    if (liveProgress) {
      return {
        ...job,
        phase: liveProgress.phase,
        progress: liveProgress.progress,
        processedRows: liveProgress.processedRows || job.processedRows,
        validRows: liveProgress.validRows || job.validRows,
        invalidRows: liveProgress.invalidRows || job.invalidRows,
      };
    }

    return job;
  }

  /**
   * Get all jobs with optional status filter
   */
  async getAllJobs(statusFilter?: JobStatus[]): Promise<ImportJob[]> {
    let jobs = Array.from(jobStore.values());
    
    if (statusFilter && statusFilter.length > 0) {
      jobs = jobs.filter((job) => statusFilter.includes(job.status));
    }

    return jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Cancel a running job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const job = jobStore.get(jobId);
    if (!job) return false;

    if (['pending', 'queued', 'parsing', 'validating'].includes(job.status)) {
      job.status = 'cancelled';
      job.updatedAt = new Date();
      jobStore.set(jobId, job);
      
      progressTracker.update(jobId, {
        phase: 'failed',
        message: 'Job cancelled by user',
        error: 'Cancelled',
      });

      return true;
    }

    return false;
  }

  /**
   * Subscribe to job progress updates (for SSE)
   */
  subscribeToProgress(jobId: string, callback: (update: ProgressUpdate) => void): () => void {
    const handler = (update: ProgressUpdate) => callback(update);
    progressTracker.on(`progress:${jobId}`, handler);
    
    // Return unsubscribe function
    return () => {
      progressTracker.off(`progress:${jobId}`, handler);
    };
  }

  /**
   * Process job in background with streaming and progress tracking
   */
  private async processJobInBackground(
    jobId: string,
    filePath: string,
    options: ImportOptions
  ): Promise<void> {
    const job = jobStore.get(jobId);
    if (!job) return;

    try {
      // Update status to processing
      job.status = 'parsing';
      job.startedAt = new Date();
      job.updatedAt = new Date();
      jobStore.set(jobId, job);

      progressTracker.update(jobId, {
        phase: 'parsing',
        progress: 0,
        message: 'Parsing file...',
      });

      // Stream parse and validate
      const result = await this.validateStream(
        jobId,
        filePath,
        options.validationRules || [],
        {
          sheetName: options.sheetName,
          chunkSize: options.chunkSize || 100,
        }
      );

      // Update job with results
      job.status = 'validated';
      job.validRows = result.validRows;
      job.invalidRows = result.invalidRows;
      job.processedRows = result.totalRows;
      job.result = result;
      job.updatedAt = new Date();
      jobStore.set(jobId, job);

      // If not dry run, proceed to save
      if (!options.dryRun) {
        job.status = 'saving';
        jobStore.set(jobId, job);

        const saveResult = await this.save(jobId, {
          dryRun: false,
          saveMode: options.saveMode || 'partial',
        });

        job.savedRows = saveResult.savedCount;
        job.failedSaveRows = saveResult.failedCount;
        job.status = saveResult.rolledBack ? 'failed' : 
                     saveResult.failedCount > 0 ? 'partial_success' : 'completed';
      } else {
        job.status = 'completed';
      }

      job.completedAt = new Date();
      job.updatedAt = new Date();
      jobStore.set(jobId, job);

      progressTracker.complete(jobId, {
        validRows: result.validRows,
        invalidRows: result.invalidRows,
        totalRows: result.totalRows,
      });

    } catch (error) {
      job.status = 'failed';
      job.error = (error as Error).message;
      job.updatedAt = new Date();
      job.completedAt = new Date();
      jobStore.set(jobId, job);

      progressTracker.fail(jobId, (error as Error).message);
    }
  }

  /**
   * Get summary statistics for an import
   */
  async getSummary(importId: string): Promise<ImportSummary | null> {
    const result = importStore.get(importId);
    return result?.summary || null;
  }

  /**
   * Delete import data
   */
  async deleteImport(importId: string): Promise<boolean> {
    chunkStore.delete(importId);
    progressTracker.cleanup(importId);
    return importStore.delete(importId);
  }

  /**
   * Get all errors for an import (paginated)
   */
  async getErrors(
    importId: string,
    page: number = 1,
    limit: number = 50
  ): Promise<{
    errors: ImportRow[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const result = importStore.get(importId);
    if (!result) {
      throw new Error(`Import with ID ${importId} not found`);
    }

    const allErrors = result.rows.filter((r) => !r.isValid);
    const total = allErrors.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const errors = allErrors.slice(start, start + limit);

    return {
      errors,
      total,
      page,
      totalPages,
    };
  }

  /**
   * Retry failed rows from a previous import
   */
  async retryFailedRows(
    importId: string,
    options: { saveMode?: SaveMode; onSave?: (row: Record<string, any>) => Promise<void> } = {}
  ): Promise<SaveResult> {
    const result = importStore.get(importId);
    if (!result) {
      throw new Error(`Import with ID ${importId} not found`);
    }

    // Get rows that failed to save but were valid
    const retryableRows = result.rows.filter((r) => r.isValid && r.saveError);

    if (retryableRows.length === 0) {
      return {
        savedCount: 0,
        failedCount: 0,
        savedRows: [],
        failedRows: [],
        mode: options.saveMode || 'partial',
        rolledBack: false,
      };
    }

    // Reset save errors
    retryableRows.forEach((r) => {
      delete r.saveError;
      delete r.savedAt;
    });

    const invalidRows = result.rows.filter((r) => !r.isValid);

    if (options.saveMode === 'transactional') {
      return this.saveTransactional(importId, retryableRows, invalidRows, options.onSave);
    } else {
      return this.savePartial(importId, retryableRows, invalidRows, options.onSave);
    }
  }
}

export const importService = new ImportService();
