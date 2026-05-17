import { MetadataService } from '../../../src/services/metadata.service';
import { ILogger } from '../../../src/services/interfaces';
import { isSuccess, isFailure } from '../../../src/types/result';

// Mock logger
function createMockLogger(): ILogger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}

describe('MetadataService', () => {
  let service: MetadataService;
  let mockLogger: ILogger;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger = createMockLogger();
    service = new MetadataService(mockLogger);
  });

  describe('getInstanceId', () => {
    it('should return failure with METADATA_UNAVAILABLE when IMDS is unreachable', async () => {
      const result = await service.getInstanceId();

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe('METADATA_UNAVAILABLE');
        expect(result.error.message).toBe('Failed to acquire IMDSv2 token');
        expect(result.error.cause).toBeDefined();
      }
    });

    it('should log error when token acquisition fails', async () => {
      await service.getInstanceId();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to acquire IMDSv2 token',
        expect.objectContaining({ error: expect.anything() })
      );
    });
  });

  describe('getAvailabilityZone', () => {
    it('should return failure with METADATA_UNAVAILABLE when IMDS is unreachable', async () => {
      const result = await service.getAvailabilityZone();

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe('METADATA_UNAVAILABLE');
        expect(result.error.message).toBe('Failed to acquire IMDSv2 token');
        expect(result.error.cause).toBeDefined();
      }
    });
  });

  describe('token caching', () => {
    it('should attempt token acquisition on each call when token is not cached', async () => {
      // Both calls should fail since IMDS is not available
      const result1 = await service.getInstanceId();
      const result2 = await service.getAvailabilityZone();

      expect(isFailure(result1)).toBe(true);
      expect(isFailure(result2)).toBe(true);

      // Logger should be called for each failed token attempt
      expect(mockLogger.error).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('should include cause in the error result', async () => {
      const result = await service.getInstanceId();

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.cause).toBeDefined();
      }
    });

    it('should use METADATA_UNAVAILABLE error code consistently', async () => {
      const instanceResult = await service.getInstanceId();
      const azResult = await service.getAvailabilityZone();

      if (isFailure(instanceResult)) {
        expect(instanceResult.error.code).toBe('METADATA_UNAVAILABLE');
      }
      if (isFailure(azResult)) {
        expect(azResult.error.code).toBe('METADATA_UNAVAILABLE');
      }
    });
  });
});
