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
 * If the file transport cannot be created (e.g., permission denied), falls back to console only.
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

  const transports: winston.transport[] = [consoleTransport];

  // Attempt to add file rotation transport. If the directory is not writable
  // (e.g., in CI or local dev without /var/log access), skip it gracefully.
  try {
    const fileRotateTransport = new DailyRotateFile({
      filename: logFilePath,
      maxSize: logMaxSize,
      maxFiles: logMaxFiles,
      format: jsonFormat,
    });
    transports.push(fileRotateTransport);
  } catch {
    // File transport unavailable, console-only logging
  }

  const winstonLogger = winston.createLogger({
    levels: winston.config.npm.levels,
    level: 'debug',
    format: jsonFormat,
    transports,
  });

  return new Logger(winstonLogger);
}

/**
 * Default logger instance for use before configuration is loaded.
 * Uses console-only transport to avoid permission issues in CI/dev environments.
 */
export function createConsoleLogger(): Logger {
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
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [consoleTransport],
  });

  return new Logger(winstonLogger);
}

/**
 * Default logger instance for use before configuration is loaded.
 * Console-only to avoid file permission issues during module import.
 */
export const logger: ILogger = createConsoleLogger();
