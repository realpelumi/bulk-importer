import { Router } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { importController } from './import.controller';
import { config } from '../../config';

// Ensure upload directory exists
const uploadDir = path.resolve(config.uploadDir);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `import-${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimes = [
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ];

  const allowedExts = ['.csv', '.xls', '.xlsx'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only CSV and Excel files are allowed.'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.maxFileSize,
  },
});

const router = Router();

// ==================== FILE UPLOAD ====================

/**
 * @route   POST /api/import/upload
 * @desc    Upload CSV/Excel file and get preview
 * @access  Public
 */
router.post('/upload', upload.single('file'), (req, res) => importController.upload(req, res));

/**
 * @route   GET /api/import/:importId/sheets
 * @desc    Get available sheets from Excel file
 * @access  Public
 */
router.get('/:importId/sheets', (req, res) => importController.getSheets(req, res));

// ==================== VALIDATION ====================

/**
 * @route   POST /api/import/:importId/validate
 * @desc    Validate uploaded file with given rules (supports streaming mode)
 * @body    { rules: ValidationRule[], streaming?: boolean, chunkSize?: number }
 * @access  Public
 */
router.post('/:importId/validate', (req, res) => importController.validate(req, res));

/**
 * @route   GET /api/import/:importId/errors
 * @desc    Get validation errors (paginated)
 * @query   page, limit
 * @access  Public
 */
router.get('/:importId/errors', (req, res) => importController.getErrors(req, res));

// ==================== SAVE OPERATIONS ====================

/**
 * @route   POST /api/import/:importId/save
 * @desc    Save validated data (supports dry-run and save modes)
 * @body    { dryRun?: boolean, saveMode?: 'partial' | 'transactional' }
 * @access  Public
 */
router.post('/:importId/save', (req, res) => importController.save(req, res));

/**
 * @route   POST /api/import/:importId/retry
 * @desc    Retry failed rows from previous save attempt
 * @body    { saveMode?: 'partial' | 'transactional' }
 * @access  Public
 */
router.post('/:importId/retry', (req, res) => importController.retryFailed(req, res));

// ==================== EXPORT & SUMMARY ====================

/**
 * @route   GET /api/import/:importId/export-failed
 * @desc    Export failed rows as CSV/Excel
 * @query   format (csv | xlsx)
 * @access  Public
 */
router.get('/:importId/export-failed', (req, res) => importController.exportFailed(req, res));

/**
 * @route   GET /api/import/:importId/summary
 * @desc    Get import summary statistics
 * @access  Public
 */
router.get('/:importId/summary', (req, res) => importController.getSummary(req, res));

/**
 * @route   DELETE /api/import/:importId
 * @desc    Delete import and associated files
 * @access  Public
 */
router.delete('/:importId', (req, res) => importController.deleteImport(req, res));

// ==================== BACKGROUND JOBS ====================

/**
 * @route   POST /api/import/jobs
 * @desc    Create background job for large file processing
 * @form    file, rules (JSON string), sheetName, saveMode, dryRun, chunkSize
 * @access  Public
 */
router.post('/jobs', upload.single('file'), (req, res) => importController.createJob(req, res));

/**
 * @route   GET /api/import/jobs
 * @desc    Get all jobs (with optional status filter)
 * @query   status (comma-separated: pending,processing,completed,failed)
 * @access  Public
 */
router.get('/jobs', (req, res) => importController.getAllJobs(req, res));

/**
 * @route   GET /api/import/jobs/:jobId
 * @desc    Get background job status
 * @access  Public
 */
router.get('/jobs/:jobId', (req, res) => importController.getJobStatus(req, res));

/**
 * @route   GET /api/import/jobs/:jobId/stream
 * @desc    Stream job progress via Server-Sent Events (SSE)
 * @access  Public
 */
router.get('/jobs/:jobId/stream', (req, res) => importController.streamJobProgress(req, res));

/**
 * @route   POST /api/import/jobs/:jobId/cancel
 * @desc    Cancel a running job
 * @access  Public
 */
router.post('/jobs/:jobId/cancel', (req, res) => importController.cancelJob(req, res));

// Legacy routes for backwards compatibility
router.post('/job', upload.single('file'), (req, res) => importController.createJob(req, res));
router.get('/job/:jobId', (req, res) => importController.getJobStatus(req, res));

export default router;
