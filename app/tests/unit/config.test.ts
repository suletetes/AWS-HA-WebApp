import { loadConfig, CONFIG_DEFAULTS, AppConfig } from '../../src/config';
import { isSuccess, isFailure } from '../../src/types/result';

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    it('returns failure when ASG_NAME is missing', () => {
      delete process.env.ASG_NAME;

      const result = loadConfig();

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe('CONFIG_INVALID');
        expect(result.error.message).toContain('ASG_NAME');
      }
    });

    it('returns success with defaults when only ASG_NAME is set', () => {
      process.env.ASG_NAME = 'my-asg';

      const result = loadConfig();

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const config = result.value;
        expect(config.asgName).toBe('my-asg');
        expect(config.port).toBe(CONFIG_DEFAULTS.port);
        expect(config.awsRegion).toBe(CONFIG_DEFAULTS.awsRegion);
        expect(config.metricsNamespace).toBe(CONFIG_DEFAULTS.metricsNamespace);
        expect(config.metricsIntervalMs).toBe(CONFIG_DEFAULTS.metricsIntervalMs);
        expect(config.dashboardRefreshMs).toBe(CONFIG_DEFAULTS.dashboardRefreshMs);
        expect(config.logFilePath).toBe(CONFIG_DEFAULTS.logFilePath);
        expect(config.logMaxSize).toBe(CONFIG_DEFAULTS.logMaxSize);
        expect(config.logMaxFiles).toBe(CONFIG_DEFAULTS.logMaxFiles);
        expect(config.healthCheckTimeoutMs).toBe(CONFIG_DEFAULTS.healthCheckTimeoutMs);
        expect(config.retryMaxAttempts).toBe(CONFIG_DEFAULTS.retryMaxAttempts);
        expect(config.retryBaseDelayMs).toBe(CONFIG_DEFAULTS.retryBaseDelayMs);
      }
    });

    it('parses numeric environment variables', () => {
      process.env.ASG_NAME = 'my-asg';
      process.env.PORT = '8080';
      process.env.METRICS_INTERVAL_MS = '120000';
      process.env.LOG_MAX_FILES = '10';

      const result = loadConfig();

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.value.port).toBe(8080);
        expect(result.value.metricsIntervalMs).toBe(120000);
        expect(result.value.logMaxFiles).toBe(10);
      }
    });

    it('uses defaults for non-numeric string values', () => {
      process.env.ASG_NAME = 'my-asg';
      process.env.PORT = 'not-a-number';

      const result = loadConfig();

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.value.port).toBe(CONFIG_DEFAULTS.port);
      }
    });

    it('reads string environment variables', () => {
      process.env.ASG_NAME = 'prod-asg';
      process.env.AWS_REGION = 'eu-west-1';
      process.env.METRICS_NAMESPACE = 'MyApp';
      process.env.LOG_FILE_PATH = '/tmp/app.log';
      process.env.LOG_MAX_SIZE = '100m';

      const result = loadConfig();

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.value.awsRegion).toBe('eu-west-1');
        expect(result.value.metricsNamespace).toBe('MyApp');
        expect(result.value.logFilePath).toBe('/tmp/app.log');
        expect(result.value.logMaxSize).toBe('100m');
      }
    });
  });

  describe('CONFIG_DEFAULTS', () => {
    it('has all expected default values', () => {
      expect(CONFIG_DEFAULTS.port).toBe(3000);
      expect(CONFIG_DEFAULTS.awsRegion).toBe('us-east-1');
      expect(CONFIG_DEFAULTS.metricsNamespace).toBe('CloudPulse');
      expect(CONFIG_DEFAULTS.metricsIntervalMs).toBe(60_000);
      expect(CONFIG_DEFAULTS.dashboardRefreshMs).toBe(30_000);
      expect(CONFIG_DEFAULTS.logFilePath).toBe('/var/log/cloudpulse/app.log');
      expect(CONFIG_DEFAULTS.logMaxSize).toBe('50m');
      expect(CONFIG_DEFAULTS.logMaxFiles).toBe(5);
      expect(CONFIG_DEFAULTS.healthCheckTimeoutMs).toBe(5_000);
      expect(CONFIG_DEFAULTS.retryMaxAttempts).toBe(3);
      expect(CONFIG_DEFAULTS.retryBaseDelayMs).toBe(1_000);
    });
  });
});
