type Callback = (error: unknown, value?: unknown) => void

export function promisify(work: (...args: unknown[]) => unknown) {
  return function promised(this: unknown, ...args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const done: Callback = (error, value) => {
        if (error)
          reject(
            error instanceof Error
              ? error
              : new Error(typeof error === 'string' ? error : 'failed'),
          )
        else resolve(value)
      }
      work.call(this, ...args, done)
    })
  }
}

export function inherits(child: { prototype: object }, parent: { prototype: object }): void {
  Object.setPrototypeOf(child.prototype, parent.prototype)
  Object.setPrototypeOf(child, parent)
}

export function inspect(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export const { TextEncoder, TextDecoder } = globalThis

export default { promisify, inherits, inspect, TextEncoder, TextDecoder }
