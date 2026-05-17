import { Request, Response, NextFunction } from 'express';
import { createErrorHandlerMiddleware } from '../../../src/middleware/error-handler';
import { ILogger } from '../../../src/services/interfaces';

describe('createErrorHandlerMiddleware', () => {
  let mockLogger: jest.Mocked<ILogger>;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let errorHandler: (err: Error, req: Request, res: Response, next: NextFunction) => void;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    mockReq = {
      correlationId: 'test-correlation-id',
      path: '/api/test',
      method: 'GET',
    };

    const jsonFn = jest.fn().mockReturnThis();
    mockRes = {
      status: jest.fn().mockReturnValue({ json: jsonFn }),
      json: jsonFn,
    };

    mockNext = jest.fn();
    errorHandler = createErrorHandlerMiddleware(mockLogger);
  });

  it('returns HTTP 500 with JSON error body', () => {
    const error = new Error('Something went wrong');

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
  });

  it('includes correlation ID in response', () => {
    const error = new Error('Something went wrong');
    const jsonFn = jest.fn();
    mockRes.status = jest.fn().mockReturnValue({ json: jsonFn });

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

    expect(jsonFn).toHaveBeenCalledWith({
      error: 'Internal server error',
      correlationId: 'test-correlation-id',
    });
  });

  it('does not expose stack traces or internal error details', () => {
    const error = new Error('Database connection failed: password=secret123');
    error.stack = 'Error: Database connection failed\n    at Object.<anonymous> (/app/src/db.ts:42:11)';
    const jsonFn = jest.fn();
    mockRes.status = jest.fn().mockReturnValue({ json: jsonFn });

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

    const responseBody = jsonFn.mock.calls[0][0];
    expect(responseBody.error).toBe('Internal server error');
    expect(responseBody).not.toHaveProperty('stack');
    expect(JSON.stringify(responseBody)).not.toContain('secret123');
    expect(JSON.stringify(responseBody)).not.toContain('db.ts');
  });

  it('logs the error with correlation ID, path, and method', () => {
    const error = new Error('Something went wrong');

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

    expect(mockLogger.error).toHaveBeenCalledWith('Unhandled error', {
      correlationId: 'test-correlation-id',
      error: 'Something went wrong',
      path: '/api/test',
      method: 'GET',
    });
  });

  it('uses "unknown" when correlationId is not set on request', () => {
    delete mockReq.correlationId;
    const jsonFn = jest.fn();
    mockRes.status = jest.fn().mockReturnValue({ json: jsonFn });

    const error = new Error('No correlation');

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

    expect(jsonFn).toHaveBeenCalledWith({
      error: 'Internal server error',
      correlationId: 'unknown',
    });

    expect(mockLogger.error).toHaveBeenCalledWith('Unhandled error', expect.objectContaining({
      correlationId: 'unknown',
    }));
  });
});
