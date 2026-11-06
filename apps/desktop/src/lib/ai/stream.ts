export const SSE_DONE = '[DONE]'

export function sseLines(held: string, chunk: string): { payloads: string[]; rest: string } {
  const text = held + chunk
  const lines = text.split('\n')
  const rest = lines.pop() ?? ''
  const payloads: string[] = []

  for (const line of lines) {
    const said = line.replace(/\r$/, '')
    if (!said.startsWith('data:')) continue

    const payload = said.slice('data:'.length).trim()
    if (payload) payloads.push(payload)
  }

  return { payloads, rest }
}

export function sseJson(payload: string): unknown {
  if (payload === SSE_DONE) return null

  try {
    return JSON.parse(payload)
  } catch {
    return null
  }
}

export async function* sseEvents(
  body: ReadableStream<Uint8Array>,
  done?: () => void,
): AsyncGenerator {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let held = ''

  try {
    for (;;) {
      const { done: ended, value } = await reader.read()
      const chunk = ended ? decoder.decode() + '\n' : decoder.decode(value, { stream: true })
      const { payloads, rest } = sseLines(held, chunk)
      held = rest
      for (const payload of payloads) {
        if (payload === SSE_DONE) done?.()
        const event = sseJson(payload)
        if (event !== null) yield event
      }
      if (ended) return
    }
  } finally {
    reader.cancel().catch(() => undefined)
  }
}
