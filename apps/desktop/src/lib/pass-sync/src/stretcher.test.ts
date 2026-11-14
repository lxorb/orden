import { stretch, useStretcher } from '@orden/pass/crypto'
import { afterEach, describe, expect, test, vi } from 'vitest'

const native = vi.hoisted(() => ({
  asked: [] as Record<string, unknown>[],
  fails: false,
  answer: '',
}))

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

vi.mock('../../platform/src/tauri', () => ({
  isNative: true,
  isDesktop: true,
  invoke: async (command: string, args: Record<string, unknown>) => {
    native.asked.push({ command, ...args })
    if (native.fails) throw new Error('no such command')
    return await Promise.resolve(native.answer)
  },
}))

const { stretcherHere, useNativeStretcher } = await import('./stretcher')

const SALT = new Uint8Array(16).map((_, at) => at * 7 + 1)
const PARAMS = { m: 64, t: 2, p: 1 }
const SECRET = 'Café horse'

afterEach(() => {
  useStretcher(null)
  native.asked = []
  native.fails = false
})

async function byNoble(): Promise<Uint8Array> {
  useStretcher(null)
  const key = await stretch(SECRET, SALT, PARAMS)
  native.answer = base64(key)
  return key
}

describe('the native stretcher', () => {
  test('asks the app with the same secret, salt and cost noble is given', async () => {
    const expected = await byNoble()
    useNativeStretcher()
    const given = await stretch(SECRET, SALT, PARAMS)
    expect(native.asked).toEqual([
      {
        command: 'pass_stretch',
        secret: SECRET.normalize('NFC'),
        salt: base64(SALT),
        m: 64,
        t: 2,
        p: 1,
      },
    ])
    expect(base64(given)).toBe(base64(expected))
  })

  test('falls back to noble when the app cannot stretch', async () => {
    const expected = await byNoble()
    native.fails = true
    useNativeStretcher()
    expect(base64(await stretch(SECRET, SALT, PARAMS))).toBe(base64(expected))
    expect(native.asked).toHaveLength(1)
    await stretch(SECRET, SALT, PARAMS)
    expect(native.asked).toHaveLength(1)
  })

  test('is there on the app', () => {
    expect(stretcherHere()).not.toBeNull()
  })
})
