import { createLogger, Logger, ILogger } from '../../../src/utils/logger';

describe('Logger', () => {
  describe('createLogger', () => {
    it('should return a Logger instance implementing ILogger', () => {
      const logger = createLogger({
        logFilePath: './test-logs/test-%DATE%.log',
        logMaxSize: '10m',
        logMaxFiles: 3,
      });

      expect(logger).toBeInstanceOf(Logger);
      expect(logger.info).toBeDefined();
      expect(logger.warn).toBeDefined();
      expect(logger.error).toBeDefined();
      expect(logger.debug).toBeDefined();
    });

    it('should use default config when no options provided', () => {
      const logger = createLogger();
      expect(logger).toBeInstanceOf(Logger);
    });

    it('should use partial config with defaults for missing values', () => {
      const logger = createLogger({ logMaxSize: '100m' });
      expect(logger).toBeInstanceOf(Logger);
    });
  });

  describe('Logger class methods', () => {
    let mockWinstonLogger: {
      info: jest.Mock;
      warn: jest.Mock;
      error: jest.Mock;
      debug: jest.Mock;
    };
    let logger: Logger;

    beforeEach(() => {
      mockWinstonLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      };
      logger = new Logger(mockWinstonLogger as any);
    });

    it('should delegate info calls to winston logger', () => {
      const meta = { requestId: '123' };
      logger.info('test message', meta);
      expect(mockWinstonLogger.info).toHaveBeenCalledWith('test message', meta);
    });

    it('should delegate warn calls to winston logger', () => {
      const meta = { code: 'TIMEOUT' };
      logger.warn('warning message', meta);
      expect(mockWinstonLogger.warn).toHaveBeenCalledWith('warning message', meta);
    });

    it('should delegate error calls to winston logger', () => {
      const meta = { error: 'something failed' };
      logger.error('error message', meta);
      expect(mockWinstonLogger.error).toHaveBeenCalledWith('error message', meta);
    });

    it('should delegate debug calls to winston logger', () => {
      logger.debug('debug message');
      expect(mockWinstonLogger.debug).toHaveBeenCalledWith('debug message', undefined);
    });

    it('should work without meta parameter', () => {
      logger.info('no meta');
      expect(mockWinstonLogger.info).toHaveBeenCalledWith('no meta', undefined);
    });
  });

  describe('ILogger interface compliance', () => {
    it('should satisfy ILogger interface contract', () => {
      const logger: ILogger = createLogger({
        logFilePath: './test-logs/interface-test-%DATE%.log',
      });

      // These should not throw
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');
      logger.debug('debug message');
      logger.info('with meta', { key: 'value' });
    });
  });
});
