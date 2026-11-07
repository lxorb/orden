import * as streams from 'readable-stream'

export function pipeline(...piped: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    ;(streams.pipeline as (...args: unknown[]) => unknown)(...piped, (error?: Error | null) =>
      error ? reject(error) : resolve(),
    )
  })
}

export default { pipeline }
