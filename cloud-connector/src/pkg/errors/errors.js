export class AppError extends Error {
    statusCode;
    code;
    isOperational;
    details;
    constructor({ message, code = 'SERVER_ERROR', statusCode = 500, isOperational = true, details, }) {
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
    constructor(message, details) {
        super({ message, code: 'VALIDATION_ERROR', statusCode: 400, details });
    }
}
export class AuthenticationError extends AppError {
    constructor(message = 'Authentication failed') {
        super({ message, code: 'AUTHENTICATION_FAILED', statusCode: 401 });
    }
}
export class ConnectorError extends AppError {
    constructor(message, details) {
        super({ message, code: 'CONNECTOR_ERROR', statusCode: 502, details });
    }
}
export function isAppError(err) {
    return err instanceof AppError;
}
export function buildStructuredError(requestId, err) {
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
export function structuredErrorStatus(err) {
    return isAppError(err) ? err.statusCode : 500;
}
