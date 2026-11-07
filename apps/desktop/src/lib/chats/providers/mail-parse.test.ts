import { parseMessage } from '@orden/chats/mime'
import { expect, test, vi } from 'vitest'

const asked: number[] = []

class Away {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  postMessage(said: { id: number; bytes: Uint8Array }) {
    asked.push(said.id)
    queueMicrotask(() =>
      this.onmessage?.({
        data: { id: said.id, parsed: parseMessage(said.bytes) },
      } as MessageEvent),
    )
  }
  terminate() {
    asked.push(-1)
  }
}

vi.stubGlobal('Worker', Away)

const { parsedOffThread } = await import('./mail-parse')

test('a mail is taken apart off the window’s thread, into what it says', async () => {
  const mail = new TextEncoder().encode('Subject: Hi\r\n\r\nAt noon?')
  const parsed = await parsedOffThread(mail)
  expect(asked).toEqual([1])
  expect(parsed.text).toBe('At noon?')
  expect(parsed.headers.get('subject')).toEqual(['Hi'])
})
