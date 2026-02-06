import { Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { importService } from './import.service';
import { progressTracker } from '../../utils/progressTracker';
import { ApiResponse, UploadResponse, ValidationResponse, SaveResponse, JobStatusResponse } from '../../types/api.types';
import { ValidationRule, ParsedFile, SaveMode, JobStatus } from '../../types/import.types';
import { config } from '../../config';

// Temporary storage for parsed files (in production, use Redis or similar)
const parsedFileStore: Map<string, { filePath: string; parsed: ParsedFile }> = new Map();

export class ImportController {
  /**
   * Upload file and return preview
   */
  async upload(req: Request, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({
          success: false,
          message: 'No file uploaded',
          timestamp: new Date(),
        } as ApiResponse);
        return;
      }

      const filePath = req.file.path;
      const sheetName = req.body.sheetName;

      const { importId, parsed, preview, totalRows } = await importService.uploadAndParse(filePath, { sheetName });

      // Store for later validation
      parsedFileStore.set(importId, { filePath, parsed });

      const response: ApiResponse<UploadResponse> = {
        success: true,
        message: 'File uploaded successfully',
        data: {
          importId,
          fileName: req.file.originalname,
          rowCount: totalRows,
          headers: parsed.headers,
          previewRows: preview,
        },
        timestamp: new Date(),
      };

      res.status(200).json(response);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Upload failed',
        error: (error as Error).message,
        timestamp: new Date(),
      } as ApiResponse);
    }
  }

  /**
   * Get sheet names from uploaded Excel file
   */
  async getSheets(req: Request, res: Response): Promise<void> {
    try {
      const importId = req.params.importId as string;
      const stored = parsedFileStore.get(importId);

      if (!stored) {
        res.status(404).json({
          success: false,
          message: 'Import not found',
          timestamp: new Date(),
        } as ApiResponse);
        return;
      }

      const { FileParser } = await import('../../utils/fileParser');
      const sheets = FileParser.getSheetNames(stored.filePath);

      res.status(200).json({
        success: true,
        message: 'Sheets retrieved successfully',
        data: { sheets },
        timestamp: new Date(),
      } as ApiResponse);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get sheets',
        error: (error as Error).message,
        timestamp: new Date(),
      } as ApiResponse);
    }
  }

  /**
   * Validate uploaded file with given rules (with streaming support)
   */
  async validate(req: Request, res: Response): Promise<void> {
    try {
      const importId = req.params.importId as string;
      const { rules, streaming = false, chunkSize = 100 } = req.body as {
        rules?: ValidationRule[];
        streaming?: boolean;
        chunkSize?: number;
      };

      const stored = parsedFileStore.get(importId);
      if (!stored) {
        res.status(404).json({
          success: false,
          message: 'Import not found. Please upload a file first.',
          timestamp: new Date(),
        } as ApiResponse);
        return;
      }

      let result;
      if (streaming) {
        // Use streaming validation for large files
        result = await importService.validateStream(
          importId,
          stored.filePath,
          rules || [],
          { chunkSize }
        );
      } else {
        // Use sync validation for small files
        result = await importService.validate(importId, stored.parsed, rules || []);
      }

      const response: ApiResponse<ValidationResponse> = {
        success: true,
        message: result.invalidRows > 0
          ? `Validation completed with ${result.invalidRows} error(s)`
          : 'Validation successful - all rows are valid',
        data: {
          importId: importId as string,
          totalRows: result.totalRows,
          validRows: result.validRows,
          invalidRows: result.invalidRows,
          errors: result.rows
            .filter((r) => !r.isValid)
            .slice(0, 100)
            .map((r) => ({
              rowNumber: r.rowNumber,
              errors: r.errors.map((e) => ({ field: e.field, message: e.message })),
            })),
          isValid: result.invalidRows === 0,
        },
        timestamp: new Date(),
      };

      res.status(200).json(response);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Validation failed',
        error: (error as Error).message,
        timestamp: new Date(),
      } as ApiResponse);
    }
  }

  /**
   * Preview validation errors
   */
  async getErrors(req: Request, res: Response): Promise<void> {
    try {
      const importId = req.params.importId as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;

      const errors = await importService.getErrors(importId, page, limit);

      res.status(200).json({
        success: true,
        message: 'Errors retrieved successfully',
        data: errors,
        timestamp: new Date(),
      } as ApiResponse);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve errors',
        error: (error as Error).message,
        timestamp: new Date(),
      } as ApiResponse);
    }
  }

  /**
   * Save validated data (with dry-run and save mode support)
   */
  async save(req: Request, res: Response): Promise<void> {
    try {
      const importId = req.params.importId as string;
      const { dryRun = false, saveMode = 'partial' } = req.body as {
        dryRun?: boolean;
        saveMode?: SaveMode;
      };

      const result = await importService.save(importId, { dryRun, saveMode });

      const response: ApiResponse<SaveResponse> = {
        success: true,
        message: dryRun
          ? `Dry run complete: ${result.savedCount} rows would be saved, ${result.failedCount} would fail`
          : result.rolledBack
            ? `Transaction rolled back: no rows saved`
            : `Save complete: ${result.savedCount} rows saved, ${result.failedCount} failed`,
        data: {
          importId: importId as string,
          savedCount: result.savedCount,
          failedCount: result.failedCount,
          message: dryRun
            ? 'This was a dry run - no data was saved'
            : result.rolledBack
              ? 'Transaction was rolled back due to an error'
              : 'Data saved successfully',
          mode: result.mode,
          rolledBack: result.rolledBack,
        },
        timestamp: new Date(),
      };

      res.status(200).json(response);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Save operation failed',
        error: (error as Error).message,
        timestamp: new Date(),
      } as ApiResponse);
    }
  }

  /**
   * Retry failed rows
   */
  async retryFailed(req: Request, res: Response): Promise<void> {
    try {
      const importId = req.params.importId as string;
      const { saveMode = 'partial' } = req.body as { saveMode?: SaveMode };

      const result = await importService.retryFailedRows(importId, { saveMode });

      res.status(200).json({
        success: true,
        message: `Retry complete: ${result.savedCount} saved, ${result.failedCount} still failed`,
        data: {
          savedCount: result.savedCount,
          failedCount: result.failedCount,
          mode: result.mode,
          rolledBack: result.rolledBack,
        },
        timestamp: new Date(),
      } as ApiResponse);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Retry operation failed',
        error: (error as Error).message,
        timestamp: new Date(),
      } as ApiResponse);
    }
  }

  /**
   * Export failed rows for download
   */
  async exportFailed(req: Request, res: Response): Promise<void> {
    try {
      const importId = req.params.importId as string;
      const format = (req.query.format as 'csv' | 'xlsx') || 'csv';

      const filePath = await importService.exportFailedRows(importId, format);
      const fileName = path.basename(filePath);

      res.download(filePath, fileName, (err) => {
        if (err) {
          console.error('Download error:', err);
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Export failed',
        error: (error as Error).message,
        timestamp: new Date(),
      } as ApiResponse);
    }
  }

  /**
   * Create background job for large files
   */
  async createJob(req: Request, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({
          success: false,
          message: 'No file uploaded',
          timestamp: new Date(),
        } as ApiResponse);
        return;
      }

      const { rules, sheetName, saveMode = 'partial', dryRun = false, chunkSize = 100 } = req.body;
      const parsedRules = rules ? (typeof rules === 'string' ? JSON.parse(rules) : rules) : [];

      const job = await importService.createBackgroundJob(req.file.path, {
        validationRules: parsedRules,
        sheetName,
        saveMode,
        dryRun: dryRun === 'true' || dryRun === true,
        chunkSize: parseInt(chunkSize, 10),
      });

      res.status(202).json({
        success: true,
        message: 'Background job created',
        data: {
          jobId: job.id,
          status: job.status,
          totalRows: job.totalRows,
          saveMode: job.saveMode,
          message: 'Your file is being processed. Use the job status endpoint or SSE stream to track progress.',
        },
        timestamp: new Date(),
      } as ApiResponse);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to create background job',
        error: (error as Error).message,
        timestamp: new Date(),
      } as ApiResponse);
    }
  }

  /**
   * Get background job status
   */
  async getJobStatus(req: Request, res: Response): Promise<void> {
    try {
      const jobId = req.params.jobId as string;
      const job = await importService.getJobStatus(jobId);

      if (!job) {
        res.status(404).json({
          success: false,
          message: 'Job not found',
          timestamp: new Date(),
        } as ApiResponse);
        return;
      }

      const response: ApiResponse<JobStatusResponse> = {
        success: true,
        message: `Job status: ${job.status}`,
        data: {
          jobId: job.id,
          status: job.status,
          phase: job.phase,
          progress: job.progress,
          totalRows: job.totalRows,
          processedRows: job.processedRows,
          validRows: job.validRows,
          invalidRows: job.invalidRows,
          savedRows: job.savedRows,
          failedSaveRows: job.failedSaveRows,
          saveMode: job.saveMode,
          result: job.result ? {
            totalRows: job.result.totalRows,
            validRows: job.result.validRows,
            invalidRows: job.result.invalidRows,
          } : undefined,
          error: job.error,
          createdAt: job.createdAt,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          updatedAt: job.updatedAt,
        },
        timestamp: new Date(),
      };

      res.status(200).json(response);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get job status',
        error: (error as Error).message,
        timestamp: new Date(),
      } as ApiResponse);
    }
  }

  /**
   * Get all jobs with optional status filter
   */
  async getAllJobs(req: Request, res: Response): Promise<void> {
    try {
      const statusFilter = req.query.status as string | undefined;
      const statuses = statusFilter ? statusFilter.split(',') as JobStatus[] : undefined;

      const jobs = await importService.getAllJobs(statuses);

      res.status(200).json({
        success: true,
        message: `Found ${jobs.length} jobs`,
        data: {
          jobs: jobs.map((job) => ({
            jobId: job.id,
            fileName: job.fileName,
            status: job.status,
            phase: job.phase,
            progress: job.progress,
            totalRows: job.totalRows,
            validRows: job.validRows,
            invalidRows: job.invalidRows,
            saveMode: job.saveMode,
            createdAt: job.createdAt,
            completedAt: job.completedAt,
          })),
          total: jobs.length,
        },
        timestamp: new Date(),
      } as ApiResponse);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get jobs',
        error: (error as Error).message,
        timestamp: new Date(),
      } as ApiResponse);
    }
  }

  /**
   * Cancel a running job
   */
  async cancelJob(req: Request, res: Response): Promise<void> {
    try {
      const jobId = req.params.jobId as string;
      const cancelled = await importService.cancelJob(jobId);

      if (cancelled) {
        res.status(200).json({
          success: true,
          message: 'Job cancelled successfully',
          timestamp: new Date(),
        } as ApiResponse);
      } else {
        res.status(400).json({
          success: false,
          message: 'Job cannot be cancelled (already completed or not found)',
          timestamp: new Date(),
        } as ApiResponse);
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to cancel job',
        error: (error as Error).message,
        timestamp: new Date(),
      } as ApiResponse);
    }
  }

  /**
   * Stream job progress via Server-Sent Events (SSE)
   */
  async streamJobProgress(req: Request, res: Response): Promise<void> {
    const jobId = req.params.jobId as string;

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: 'connected', jobId })}\n\n`);

    // Send current progress immediately
    const currentProgress = progressTracker.getProgress(jobId);
    if (currentProgress) {
      res.write(`data: ${JSON.stringify({ type: 'progress', ...currentProgress })}\n\n`);
    }

    // Subscribe to progress updates
    const unsubscribe = importService.subscribeToProgress(jobId, (update) => {
      res.write(`data: ${JSON.stringify({ type: 'progress', ...update })}\n\n`);

      // Close connection when job is complete
      if (['completed', 'failed', 'partial_success', 'cancelled'].includes(update.phase)) {
        res.write(`data: ${JSON.stringify({ type: 'complete', ...update })}\n\n`);
        setTimeout(() => {
          unsubscribe();
          res.end();
        }, 1000);
      }
    });

    // Handle client disconnect
    req.on('close', () => {
      unsubscribe();
    });
  }

  /**
   * Get import summary
   */
  async getSummary(req: Request, res: Response): Promise<void> {
    try {
      const importId = req.params.importId as string;
      const summary = await importService.getSummary(importId);

      if (!summary) {
        res.status(404).json({
          success: false,
          message: 'Import not found',
          timestamp: new Date(),
        } as ApiResponse);
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Summary retrieved successfully',
        data: summary,
        timestamp: new Date(),
      } as ApiResponse);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get summary',
        error: (error as Error).message,
        timestamp: new Date(),
      } as ApiResponse);
    }
  }

  /**
   * Delete import data
   */
  async deleteImport(req: Request, res: Response): Promise<void> {
    try {
      const importId = req.params.importId as string;

      // Clean up stored files
      const stored = parsedFileStore.get(importId);
      if (stored && fs.existsSync(stored.filePath)) {
        fs.unlinkSync(stored.filePath);
      }
      parsedFileStore.delete(importId);

      const deleted = await importService.deleteImport(importId);

      res.status(200).json({
        success: true,
        message: deleted ? 'Import deleted successfully' : 'Import not found',
        timestamp: new Date(),
      } as ApiResponse);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to delete import',
        error: (error as Error).message,
        timestamp: new Date(),
      } as ApiResponse);
    }
  }
}

export const importController = new ImportController();
