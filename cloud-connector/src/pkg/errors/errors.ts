export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_FAILED'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'CONNECTOR_ERROR'
  | 'SERVER_ERROR'
  | 'DEAD_LETTER';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly isOperational: boolean;
  readonly details?: unknown;

  constructor({
    message,
    code = 'SERVER_ERROR',
    statusCode = 500,
    isOperational = true,
    details,
  }: {
    message: string;
    code?: ErrorCode;
    statusCode?: number;
    isOperational?: boolean;
    details?: unknown;
  }) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super({ message, code: 'VALIDATION_ERROR', statusCode: 400, details });
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed') {
    super({ message, code: 'AUTHENTICATION_FAILED', statusCode: 401 });
  }
}

export class ConnectorError extends AppError {
  constructor(message: string, details?: unknown) {
    super({ message, code: 'CONNECTOR_ERROR', statusCode: 502, details });
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export interface StructuredError {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

export function buildStructuredError(requestId: string, err: unknown): StructuredError {
  if (isAppError(err)) {
    return {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
        requestId,
      },
    };
  }
  const message = err instanceof Error ? err.message : 'Unexpected error';
  return {
    error: { code: 'SERVER_ERROR', message, requestId },
  };
}

export function structuredErrorStatus(err: unknown): number {
  return isAppError(err) ? err.statusCode : 500;
}




