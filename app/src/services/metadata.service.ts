import http from 'http';
import { Result, AppError, success, failure } from '../types/result';
import { IMetadataService, ILogger } from './interfaces';

const IMDS_BASE = 'http://169.254.169.254';
const TOKEN_PATH = '/latest/api/token';
const INSTANCE_ID_PATH = '/latest/meta-data/instance-id';
const AVAILABILITY_ZONE_PATH = '/latest/meta-data/placement/availability-zone';
const TOKEN_TTL_SECONDS = 21600;
const REQUEST_TIMEOUT_MS = 5000;

/**
 * MetadataService retrieves EC2 instance metadata using IMDSv2.
 *
 * IMDSv2 requires a session token acquired via PUT request before
 * any metadata can be retrieved via GET requests.
 */
export class MetadataService implements IMetadataService {
  private readonly logger: ILogger;
  private cachedToken: string | null = null;

  constructor(logger: ILogger) {
    this.logger = logger;
  }

  async getInstanceId(): Promise<Result<string, AppError>> {
    return this.getMetadata(INSTANCE_ID_PATH);
  }

  async getAvailabilityZone(): Promise<Result<string, AppError>> {
    return this.getMetadata(AVAILABILITY_ZONE_PATH);
  }

  private async getMetadata(path: string): Promise<Result<string, AppError>> {
    const tokenResult = await this.acquireToken();
    if (tokenResult.kind === 'failure') {
      return tokenResult;
    }

    const token = tokenResult.value;

    try {
      const body = await this.httpGet(path, {
        'X-aws-ec2-metadata-token': token,
      });
      this.logger.info('Retrieved metadata', { path });
      return success(body);
    } catch (error) {
      this.logger.error('Failed to retrieve instance metadata', { path, error });
      return failure({
        code: 'METADATA_UNAVAILABLE',
        message: `Failed to retrieve instance metadata: ${path}`,
        cause: error,
      });
    }
  }

  private async acquireToken(): Promise<Result<string, AppError>> {
    if (this.cachedToken) {
      return success(this.cachedToken);
    }

    try {
      const token = await this.httpPut(TOKEN_PATH, {
        'X-aws-ec2-metadata-token-ttl-seconds': String(TOKEN_TTL_SECONDS),
      });
      this.cachedToken = token;
      this.logger.info('Acquired IMDSv2 token');
      return success(token);
    } catch (error) {
      this.logger.error('Failed to acquire IMDSv2 token', { error });
      return failure({
        code: 'METADATA_UNAVAILABLE',
        message: 'Failed to acquire IMDSv2 token',
        cause: error,
      });
    }
  }

  private httpGet(path: string, headers: Record<string, string>): Promise<string> {
    return this.httpRequest('GET', path, headers);
  }

  private httpPut(path: string, headers: Record<string, string>): Promise<string> {
    return this.httpRequest('PUT', path, headers);
  }

  private httpRequest(
    method: string,
    path: string,
    headers: Record<string, string>
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, IMDS_BASE);

      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port || 80,
          path: url.pathname,
          method,
          headers,
          timeout: REQUEST_TIMEOUT_MS,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data);
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            }
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`));
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.end();
    });
  }
}
