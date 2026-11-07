import { Buffer } from 'buffer'
import { Unzlib, unzlibSync } from 'fflate'
import { Transform } from './stream'

type Done = (error: Error | null, result?: Buffer) => void

export function inflateSync(input: Uint8Array): Buffer {
  return Buffer.from(unzlibSync(input))
}

export function inflate(input: Uint8Array, done: Done): void {
  let result: Buffer
  try {
    result = inflateSync(input)
  } catch (error) {
    queueMicrotask(() => done(error instanceof Error ? error : new Error(String(error))))
    return
  }
  queueMicrotask(() => done(null, result))
}

export function createInflate(): InstanceType<typeof Transform> {
  const pending: Buffer[] = []
  const unzlib = new Unzlib((chunk) => {
    pending.push(Buffer.from(chunk))
  })
  const failed = (error: unknown) => (error instanceof Error ? error : new Error(String(error)))
  const stream: InstanceType<typeof Transform> = new Transform({
    transform(chunk: Uint8Array, _encoding: string, done: (error?: Error | null) => void) {
      try {
        unzlib.push(chunk, false)
        for (const one of pending.splice(0)) stream.push(one)
        done()
      } catch (error) {
        done(failed(error))
      }
    },
    flush(done: (error?: Error | null) => void) {
      try {
        unzlib.push(new Uint8Array(0), true)
        for (const one of pending.splice(0)) stream.push(one)
        done()
      } catch (error) {
        done(failed(error))
      }
    },
  })
  return stream
}

export default { inflate, inflateSync, createInflate }
