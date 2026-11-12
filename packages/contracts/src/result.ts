export type ErrorKind =
  | 'invalid'
  | 'missing'
  | 'refused'
  | 'conflict'
  | 'unreachable'
  | 'timeout'
  | 'too-large'
  | 'unsupported'
  | 'failed'

export interface OrdenError {
  readonly kind: ErrorKind
  readonly message: string
  readonly module: string
  readonly status?: number
  readonly cause?: unknown
}

export type Result<Value, Failure = OrdenError> =
  { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: Failure }

export function ok<Value>(value: Value): Result<Value, never> {
  return { ok: true, value }
}

export function err<Failure>(error: Failure): Result<never, Failure> {
  return { ok: false, error }
}

export function failure(
  module: string,
  kind: ErrorKind,
  message: string,
  more: { status?: number; cause?: unknown } = {},
): OrdenError {
  return {
    kind,
    message,
    module,
    ...(more.status === undefined ? {} : { status: more.status }),
    ...(more.cause === undefined ? {} : { cause: more.cause }),
  }
}

export function isOk<Value, Failure>(
  result: Result<Value, Failure>,
): result is { readonly ok: true; readonly value: Value } {
  return result.ok
}

export function mapResult<Value, Next, Failure>(
  result: Result<Value, Failure>,
  next: (value: Value) => Next,
): Result<Next, Failure> {
  return result.ok ? { ok: true, value: next(result.value) } : result
}

export function unwrapOr<Value, Failure>(result: Result<Value, Failure>, fallback: Value): Value {
  return result.ok ? result.value : fallback
}

export function attempt<Value>(
  module: string,
  run: () => Value,
  kind: ErrorKind = 'failed',
): Result<Value> {
  try {
    return ok(run())
  } catch (cause) {
    return err(
      failure(module, kind, cause instanceof Error ? cause.message : String(cause), { cause }),
    )
  }
}

export async function attemptAsync<Value>(
  module: string,
  run: () => Promise<Value>,
  kind: ErrorKind = 'failed',
): Promise<Result<Value>> {
  try {
    return ok(await run())
  } catch (cause) {
    return err(
      failure(module, kind, cause instanceof Error ? cause.message : String(cause), { cause }),
    )
  }
}
