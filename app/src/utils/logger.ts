import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

/**
 * Logger interface for dependency injection.
 * All services should depend on this interface rather than Winston directly.
 */
export interface ILogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Configuration options for creating a logger instance.
 */
export interface LoggerConfig {
  readonly logFilePath?: string;
  readonly logMaxSize?: string;
  readonly logMaxFiles?: number;
}

const DEFAULT_LOG_FILE_PATH = '/var/log/cloudpulse/app.log';
const DEFAULT_LOG_MAX_SIZE = '50m';
const DEFAULT_LOG_MAX_FILES = 5;

/**
 * Logger class wrapping Winston for dependency injection.
 * Implements ILogger so services can be tested with mock loggers.
 */
export class Logger implements ILogger {
  private readonly winstonLogger: winston.Logger;

  constructor(winstonLogger: winston.Logger) {
    this.winstonLogger = winstonLogger;
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.winstonLogger.info(message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.winstonLogger.warn(message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.winstonLogger.error(message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.winstonLogger.debug(message, meta);
  }
}

/**
 * Creates a Winston logger instance with JSON format, file rotation, and console output.
 *
 * @param config - Logger configuration options
 * @returns A Logger instance implementing ILogger
 */
export function createLogger(config?: LoggerConfig): Logger {
  const logFilePath = config?.logFilePath ?? DEFAULT_LOG_FILE_PATH;
  const logMaxSize = config?.logMaxSize ?? DEFAULT_LOG_MAX_SIZE;
  const logMaxFiles = config?.logMaxFiles ?? DEFAULT_LOG_MAX_FILES;

  const jsonFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  );

  const fileRotateTransport = new DailyRotateFile({
    filename: logFilePath,
    maxSize: logMaxSize,
    maxFiles: logMaxFiles,
    format: jsonFormat,
  });

  const consoleTransport = new winston.transports.Console({
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} [${level}]: ${message}${metaStr}`;
      })
    ),
  });

  const winstonLogger = winston.createLogger({
    levels: winston.config.npm.levels,
    level: 'debug',
    format: jsonFormat,
    transports: [fileRotateTransport, consoleTransport],
  });

  return new Logger(winstonLogger);
}

/**
 * Default logger instance for use before configuration is loaded.
 * Uses default file path and rotation settings.
 */
export const logger: ILogger = createLogger();
