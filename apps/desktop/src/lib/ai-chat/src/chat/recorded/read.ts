import { readFileSync } from 'node:fs'
import { sseJson, sseLines } from '../../../../ai-providers/src/api'

function streamText(name: string): string {
  return readFileSync(new URL(`./${name}.sse`, import.meta.url), 'utf8')
}

export function events(name: string): unknown[] {
  const { payloads } = sseLines('', `${streamText(name)}\n`)
  return payloads.map(sseJson).filter((one) => one !== null)
}

export function body(name: string, chunk = 97): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(streamText(name))
  let at = 0
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) {
        controller.close()
        return
      }
      controller.enqueue(bytes.slice(at, at + chunk))
      at += chunk
    },
  })
}
