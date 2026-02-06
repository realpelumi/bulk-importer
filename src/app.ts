import express, { Request, Response } from 'express';
import cors from 'cors';
import { config } from './config';
import { importRoutes } from './modules/import';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Bulk Importer API is running',
    version: '1.0.0',
    timestamp: new Date(),
  });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Server is healthy',
    timestamp: new Date(),
  });
});

// API Routes
app.use('/api/import', importRoutes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
app.listen(config.port, () => {
  console.log(`🚀 Bulk Importer API running on http://localhost:${config.port}`);
  console.log(`📁 Upload directory: ${config.uploadDir}`);
  console.log(`📊 Max file size: ${(config.maxFileSize / 1024 / 1024).toFixed(2)} MB`);
});

export default app;
