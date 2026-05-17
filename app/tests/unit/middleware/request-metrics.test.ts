import { Request, Response, NextFunction } from 'express';
import { EventEmitter } from 'events';
import { createRequestMetricsMiddleware } from '../../../src/middleware/request-metrics';
import { IMetricsService } from '../../../src/services/interfaces';

describe('createRequestMetricsMiddleware', () => {
  let mockMetricsService: jest.Mocked<IMetricsService>;
  let middleware: (req: Request, res: Response, next: NextFunction) => void;

  beforeEach(() => {
    mockMetricsService = {
      recordRequest: jest.fn(),
      flushMetrics: jest.fn(),
      publishMetrics: jest.fn(),
      startPublishing: jest.fn(),
      stopPublishing: jest.fn(),
    };
    middleware = createRequestMetricsMiddleware(mockMetricsService);
  });

  function createMockReqRes(method: string, path: string, statusCode: number) {
    const req = { method, path } as Request;
    const res = new EventEmitter() as unknown as Response;
    (res as any).statusCode = statusCode;
    return { req, res };
  }

  it('calls next() immediately', () => {
    const { req, res } = createMockReqRes('GET', '/health', 200);
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('does not call recordRequest before response finishes', () => {
    const { req, res } = createMockReqRes('GET', '/', 200);
    const next = jest.fn();

    middleware(req, res, next);

    expect(mockMetricsService.recordRequest).not.toHaveBeenCalled();
  });

  it('calls recordRequest with correct parameters on response finish', () => {
    const { req, res } = createMockReqRes('POST', '/api/data', 201);
    const next = jest.fn();

    middleware(req, res, next);
    res.emit('finish');

    expect(mockMetricsService.recordRequest).toHaveBeenCalledTimes(1);
    expect(mockMetricsService.recordRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/api/data',
        statusCode: 201,
      })
    );
  });

  it('records durationMs as a non-negative number', () => {
    const { req, res } = createMockReqRes('GET', '/health', 200);
    const next = jest.fn();

    middleware(req, res, next);
    res.emit('finish');

    const call = mockMetricsService.recordRequest.mock.calls[0][0];
    expect(call.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof call.durationMs).toBe('number');
  });

  it('records correct status code for error responses', () => {
    const { req, res } = createMockReqRes('GET', '/api/fail', 500);
    const next = jest.fn();

    middleware(req, res, next);
    res.emit('finish');

    expect(mockMetricsService.recordRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/api/fail',
        statusCode: 500,
      })
    );
  });
});
