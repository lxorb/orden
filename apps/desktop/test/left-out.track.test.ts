import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test, vi } from 'vitest'
import { iconChoosing, NO_TIME_PLACES, portProvided, providePort, timePlaces } from '@orden/contracts'
import { leftOut } from '../app-build'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
})
const LIB = join(fileURLToPath(new URL('..', import.meta.url)), 'src', 'lib')
await import('../src/lib/sync-base-ports')
await import('../src/lib/no-workspace-ports')
const { timeOn } = await import('../src/lib/gates/src/api')
const { openTime } = await import('../src/lib/time/src/open')
describe('Orden Track, which is the time tracker and nothing else (#2286)', () => {
  test('has the tracker on with no experiment to turn on', () => {
    expect(__ORDEN_APP__).toBe('track')
    expect(timeOn()).toBe(true)
  })
  test('sees no space, tab or site, and pairs no space', () => {
    expect(portProvided('time.places')).toBe(false)
    expect(timePlaces()).toBe(NO_TIME_PLACES)
    expect(portProvided('sync.pairing')).toBe(false)
    expect(iconChoosing()).toBe(null)
  })
  test('opens the tracker where its own shell says, and nowhere before the shell is there', () => {
    expect(openTime()).toBe(false)
    const shown: string[] = []
    const unbind = providePort('time.open', { show: (spec) => void shown.push(spec) })
    expect(openTime({ range: 'week', from: null, to: null, untracked: true, day: null, timeline: false })).toBe(true)
    unbind()
    expect(shown.map((one) => (JSON.parse(one) as { range: string }).range)).toEqual(['week'])
  })
  test('hands its shell every part the shell asks for', async () => {
    const screens = await import('../src/lib/time/src/track/screens')
    expect(Object.keys(screens).sort()).toEqual([
      'Activities',
      'BottomSheet',
      'Day',
      'Now',
      'Stats',
      'readSpec',
      'reminders',
      'ticking',
      'undone',
    ])
    expect(typeof screens.reminders.on).toBe('boolean')
  })
  test('starts no sampler and reads no window in front, which only the whole Orden does', () => {
    const start = readFileSync(join(LIB, 'time', 'src', 'start.svelte.ts'), 'utf8')
    expect(start).toContain("if (__ORDEN_APP__ === 'orden') void import('./sense.svelte')")
    const sense = readFileSync(join(LIB, 'time', 'src', 'sense.svelte.ts'), 'utf8')
    expect(sense).not.toMatch(/workspace|sync-store/)
    const entry = readFileSync(join(LIB, '..', 'track.ts'), 'utf8')
    expect(entry).toContain("import './lib/no-workspace-ports'")
    expect(entry).not.toMatch(/\/(workspace-ports|features|start)'/)
  })
  test('is named in the one list the build and the guard both read', () => {
    for (const name of [
      'workspace',
      'documents',
      'editor',
      'tab-strip',
      'panes',
      'terminal',
      'web-tab',
      'chats-client',
    ])
      expect(leftOut('track'), name).toContain(name)
  })
})
