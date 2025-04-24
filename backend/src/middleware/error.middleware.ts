import { Request, Response, NextFunction } from 'express';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error('Error:', {
    message: err.message,
    stack: err.stack,
    code: err.code,
    statusCode: err.statusCode
  });

  // Default error status and message
  const status = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  // Handle specific error types
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      message: err.message
    });
  }

  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing authentication token'
    });
  }

  if (err.name === 'ForbiddenError') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'You do not have permission to perform this action'
    });
  }

  if (err.name === 'NotFoundError') {
    return res.status(404).json({
      error: 'Not Found',
      message: err.message
    });
  }

  // Handle Supabase errors
  if (err.code?.startsWith('PGRST')) {
    return res.status(400).json({
      error: 'Database Error',
      message: err.message
    });
  }

  // Handle Redis errors
  if (err.name === 'RedisError') {
    return res.status(503).json({
      error: 'Service Unavailable',
      message: 'Rate limiting service is temporarily unavailable'
    });
  }

  // Generic error response
  res.status(status).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? message : 'Something went wrong'
  });
}; 