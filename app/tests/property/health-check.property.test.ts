import * as fc from 'fast-check';
import { HealthService } from '../../src/services/health.service';
import { IMetadataService, ILogger } from '../../src/services/interfaces';
import { success, failure, AppError } from '../../src/types';

/**
 * Property 1: Health endpoint returns valid response for any application state
 *
 * For any application dependency state (all healthy, some failed, all failed),
 * the health endpoint SHALL always return valid JSON with a `status` field that
 * is either "healthy" or "unhealthy".
 *
 * **Validates: Requirements 6.1, 6.2**
 */
describe('Property 1: Health endpoint returns valid response for any application state', () => {
  const mockLogger: ILogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

  it('getShallowHealth always returns valid HealthResponse with correct status field', () => {
    fc.assert(
      fc.property(fc.boolean(), (isReady) => {
        const mockMetadata: IMetadataService = {
          getInstanceId: jest.fn().mockResolvedValue(success('i-123')),
          getAvailabilityZone: jest.fn().mockResolvedValue(success('us-east-1a')),
        };
        const service = new HealthService(mockMetadata, mockLogger, { healthCheckTimeoutMs: 5000 });
        service.setReady(isReady);

        const result = service.getShallowHealth();

        // Must always be valid JSON-serializable object
        expect(JSON.parse(JSON.stringify(result))).toEqual(result);
        // Must have status field
        expect(result.status).toBeDefined();
        // Status must be one of two values
        expect(['healthy', 'unhealthy']).toContain(result.status);
        // Correct mapping
        if (isReady) {
          expect(result.status).toBe('healthy');
        } else {
          expect(result.status).toBe('unhealthy');
        }
      }),
      { numRuns: 100 }
    );
  });

  it('getDeepHealth returns unhealthy when any dependency fails', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (metadataHealthy) => {
        const mockMetadata: IMetadataService = {
          getInstanceId: jest.fn().mockResolvedValue(
            metadataHealthy
              ? success('i-123')
              : failure({ code: 'METADATA_UNAVAILABLE', message: 'fail' } as AppError)
          ),
          getAvailabilityZone: jest.fn().mockResolvedValue(success('us-east-1a')),
        };
        const service = new HealthService(mockMetadata, mockLogger, { healthCheckTimeoutMs: 5000 });

        const result = await service.getDeepHealth();

        // Must always have valid structure
        expect(result.status).toBeDefined();
        expect(['healthy', 'unhealthy']).toContain(result.status);
        expect(Array.isArray(result.checks)).toBe(true);

        // Status matches dependency state
        if (metadataHealthy) {
          expect(result.status).toBe('healthy');
        } else {
          expect(result.status).toBe('unhealthy');
        }
      }),
      { numRuns: 100 }
    );
  });
});
