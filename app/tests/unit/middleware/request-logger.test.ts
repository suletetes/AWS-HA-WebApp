import { Request, Response, NextFunction } from 'express';
import { createRequestLoggerMiddleware } from '../../../src/middleware/request-logger';
import { ILogger } from '../../../src/utils/logger';

describe('createRequestLoggerMiddleware', () => {
  let mockLogger: jest.Mocked<ILogger>;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: jest.MockedFunction<NextFunction>;
  let finishHandler: (() => void) | undefined;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    mockReq = {
      method: 'GET',
      originalUrl: '/api/status',
      url: '/api/status',
    };

    finishHandler = undefined;
    mockRes = {
      statusCode: 200,
      setHeader: jest.fn(),
      on: jest.fn((event: string, handler: () => void) => {
        if (event === 'finish') {
          finishHandler = handler;
        }
        return mockRes as Response;
      }),
    };

    mockNext = jest.fn();
  });

  it('should generate a correlation ID and attach it to the request', () => {
    const middleware = createRequestLoggerMiddleware(mockLogger);
    middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockReq.correlationId).toBeDefined();
    expect(mockReq.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('should set X-Correlation-ID response header', () => {
    const middleware = createRequestLoggerMiddleware(mockLogger);
    middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'X-Correlation-ID',
      mockReq.correlationId
    );
  });

  it('should call next() immediately', () => {
    const middleware = createRequestLoggerMiddleware(mockLogger);
    middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(1);
  });

  it('should log with info for successful requests (status < 400)', () => {
    const middleware = createRequestLoggerMiddleware(mockLogger);
    mockRes.statusCode = 200;
    middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(finishHandler).toBeDefined();
    finishHandler!();

    expect(mockLogger.info).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('GET /api/status 200'),
      expect.objectContaining({
        method: 'GET',
        path: '/api/status',
        statusCode: 200,
        correlationId: mockReq.correlationId,
      })
    );
  });

  it('should log with warn for 4xx responses', () => {
    const middleware = createRequestLoggerMiddleware(mockLogger);
    mockRes.statusCode = 404;
    middleware(mockReq as Request, mockRes as Response, mockNext);

    finishHandler!();

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('GET /api/status 404'),
      expect.objectContaining({
        method: 'GET',
        path: '/api/status',
        statusCode: 404,
        correlationId: mockReq.correlationId,
      })
    );
  });

  it('should log with error for 5xx responses', () => {
    const middleware = createRequestLoggerMiddleware(mockLogger);
    mockRes.statusCode = 500;
    middleware(mockReq as Request, mockRes as Response, mockNext);

    finishHandler!();

    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('GET /api/status 500'),
      expect.objectContaining({
        method: 'GET',
        path: '/api/status',
        statusCode: 500,
        correlationId: mockReq.correlationId,
      })
    );
  });

  it('should include durationMs in log metadata', () => {
    const middleware = createRequestLoggerMiddleware(mockLogger);
    middleware(mockReq as Request, mockRes as Response, mockNext);

    finishHandler!();

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        durationMs: expect.any(Number),
      })
    );
  });

  it('should use originalUrl when available', () => {
    mockReq.originalUrl = '/api/original';
    mockReq.url = '/api/fallback';

    const middleware = createRequestLoggerMiddleware(mockLogger);
    middleware(mockReq as Request, mockRes as Response, mockNext);

    finishHandler!();

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('/api/original'),
      expect.objectContaining({ path: '/api/original' })
    );
  });

  it('should generate unique correlation IDs for different requests', () => {
    const middleware = createRequestLoggerMiddleware(mockLogger);

    const req1: Partial<Request> = { ...mockReq };
    const req2: Partial<Request> = { ...mockReq };

    middleware(req1 as Request, mockRes as Response, mockNext);
    middleware(req2 as Request, mockRes as Response, mockNext);

    expect(req1.correlationId).not.toEqual(req2.correlationId);
  });
});
