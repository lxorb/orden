import { Buffer } from 'buffer'
import * as streams from 'readable-stream'

async function* chunksOf(body: ReadableStream<Uint8Array>): AsyncGenerator<Buffer> {
  const reader = body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      yield Buffer.from(value.buffer, value.byteOffset, value.byteLength)
    }
  } finally {
    reader.releaseLock()
  }
}

export const Readable: typeof streams.Readable & {
  fromWeb(body: ReadableStream<Uint8Array>): InstanceType<typeof streams.Readable>
} = Object.assign(streams.Readable, {
  fromWeb: (body: ReadableStream<Uint8Array>) =>
    streams.Readable.from(chunksOf(body), { objectMode: false }),
})

export const { Writable, Duplex, Transform, PassThrough, pipeline, finished } = streams

export default streams
