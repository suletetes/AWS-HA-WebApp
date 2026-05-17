// src/types/result.ts — Result pattern (discriminated union) for error handling

export type Success<T> = { readonly kind: 'success'; readonly value: T };
export type Failure<E> = { readonly kind: 'failure'; readonly error: E };
export type Result<T, E = AppError> = Success<T> | Failure<E>;

export type ErrorCode =
  | 'AWS_SDK_ERROR'
  | 'METADATA_UNAVAILABLE'
  | 'CONFIG_INVALID'
  | 'TIMEOUT'
  | 'DEPENDENCY_FAILED'
  | 'UNKNOWN';

export interface AppError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

export function success<T>(value: T): Success<T> {
  return { kind: 'success', value };
}

export function failure<E>(error: E): Failure<E> {
  return { kind: 'failure', error };
}

export function isSuccess<T, E>(result: Result<T, E>): result is Success<T> {
  return result.kind === 'success';
}

export function isFailure<T, E>(result: Result<T, E>): result is Failure<E> {
  return result.kind === 'failure';
}
