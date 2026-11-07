import { expect, test, vi } from 'vitest'
import { scrypt } from './scrypt'

const asked: unknown[] = []

class Away {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  postMessage(said: {
    id: number
    password: Uint8Array<ArrayBuffer>
    salt: Uint8Array<ArrayBuffer>
    cost: { n: number; r: number; p: number }
    length: number
  }) {
    structuredClone(said)
    asked.push(said.id)
    void scrypt(said.password, said.salt, said.cost, said.length).then((key) =>
      this.onmessage?.({ data: { id: said.id, key } } as MessageEvent),
    )
  }
  terminate() {
    asked.push('ended')
  }
}

vi.stubGlobal('Worker', Away)

const { scryptOffThread } = await import('./scrypt-off')

test('the password is stretched off the window’s thread, to the same key', async () => {
  const password = new TextEncoder().encode('tulip')
  const salt = new Uint8Array([1, 2, 3, 4])
  const cost = { n: 16, r: 1, p: 1 }
  const away = await scryptOffThread(password, salt, cost, 32)
  expect(asked).toEqual([1])
  expect([...away]).toEqual([...(await scrypt(password, salt, cost, 32))])
})

test('a cost read from the app’s own state, a proxy, is sent as plain numbers', async () => {
  const password = new TextEncoder().encode('tulip')
  const salt = new Uint8Array([1, 2, 3, 4])
  const kept = new Proxy({ n: 16, r: 1, p: 1, salt: 'AQIDBA==', hash: '' }, {})
  const away = await scryptOffThread(password, salt, kept, 32)
  expect([...away]).toEqual([...(await scrypt(password, salt, { n: 16, r: 1, p: 1 }, 32))])
})
