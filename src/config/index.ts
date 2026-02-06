import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10), // 10MB default
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  validation: {
    maxRowsPreview: parseInt(process.env.MAX_ROWS_PREVIEW || '100', 10),
    largeFileTreshold: parseInt(process.env.LARGE_FILE_THRESHOLD || '1000', 10), // rows
  },
};
