import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../types/api.types';

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  console.error('Error:', err);

  // Multer file size error
  if (err.message?.includes('File too large')) {
    res.status(413).json({
      success: false,
      message: 'File too large',
      error: 'The uploaded file exceeds the maximum allowed size',
      timestamp: new Date(),
    } as ApiResponse);
    return;
  }

  // Multer file type error
  if (err.message?.includes('Invalid file type')) {
    res.status(400).json({
      success: false,
      message: 'Invalid file type',
      error: err.message,
      timestamp: new Date(),
    } as ApiResponse);
    return;
  }

  // Custom AppError
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      timestamp: new Date(),
    } as ApiResponse);
    return;
  }

  // Default server error
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    timestamp: new Date(),
  } as ApiResponse);
};

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    timestamp: new Date(),
  } as ApiResponse);
};
