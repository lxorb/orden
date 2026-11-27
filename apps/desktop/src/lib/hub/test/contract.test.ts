import { portProvided, providePort } from '@orden/contracts'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { deviceId, hubDeviceOf, madeDeviceId } from '../src/api'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
})
providePort('sync.storage', {
  text: (key) => localStorage.getItem(key),
  keepText: (key, value) => {
    localStorage.setItem(key, value)
    return true
  },
  json: () => null,
  keepJson: () => false,
  forget: (key) => localStorage.removeItem(key),
})
providePort('sync.account', { user: null } as never)
const SRC = join(import.meta.dirname, '..', 'src')
describe('the hub stands on its own', () => {
  test('reaches no app module but the platform, so an app with no sync engine can carry it', () => {
    const reached = readdirSync(SRC)
      .filter((name) => !name.includes('.test.'))
      .flatMap((name) =>
        [...readFileSync(join(SRC, name), 'utf8').matchAll(/(?:from|import\()\s*'\.\.\/\.\.\/([a-z-]+)\//g)].map(
          (found) => found[1],
        ),
      )
    expect([...new Set(reached)].sort()).toEqual(['platform'])
  })
  test('with no engine to ask, the device is the one this browser made for itself, and stays that', async () => {
    expect(portProvided('hub.device')).toBe(false)
    const made = await deviceId()
    expect(made).toMatch(/^[0-9a-f]{32}$/)
    expect(await deviceId()).toBe(made)
    expect(made).toBe(madeDeviceId(null))
  })
  test('the device an engine keeps is taken over the made one, unless it does not read as a device', () => {
    const kept = 'a'.repeat(32)
    expect(hubDeviceOf(kept, 'u1')).toBe(kept)
    expect(hubDeviceOf('not a device', 'u1')).toBe(madeDeviceId('u1'))
    expect(hubDeviceOf(null, 'u1')).toBe(madeDeviceId('u1'))
  })
})
