import { describe, expect, test, vi } from 'vitest'

/** Settings, General, Terminal, on a desktop: a row for each key that is both the app's
 *  and the shell's (Emil, issue #213), which shows the answer a terminal was given and
 *  takes it back. A file of its own because the build is a desktop's here, which the
 *  other file's is not; see terminal/two-ways.ts. */

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
})
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

vi.mock('./tauri', async (actual) => ({
  ...(await actual<typeof import('./tauri')>()),
  isDesktop: true,
  invoke: () => Promise.reject(new Error('no crate')),
}))

const { preferences } = await import('./preferences')
const { shells } = await import('./terminal/shells.svelte')
const { shortcuts } = await import('./shortcuts.svelte')

function row(label: string) {
  const found = preferences()
    .flatMap((pane) => pane.groups)
    .find((group) => group.title === 'Terminal')
    ?.fields.find((one) => one.label === label)
  if (found?.kind !== 'select') throw new Error(`no ${label}`)
  return found
}

describe('a key that is both, in Settings', () => {
  /** Every app command on a key a shell reads is both (#426), which is too many rows to
   *  stand in a list unasked: a row is there for each one somebody has answered. */
  test('has a row for each key answered, and none for one never asked about', () => {
    expect(() => row('Ctrl+N in a terminal')).toThrow()
    expect(() => row('Ctrl+Space in a terminal')).toThrow()

    shells.setWay('app.scratchpad', 'shell')
    shells.setWay('space.switcher', 'app')
    shells.setWay('app.close', 'shell')
    try {
      for (const label of [
        'Ctrl+N in a terminal',
        'Ctrl+Space in a terminal',
        'Ctrl+W in a terminal',
      ]) {
        expect(row(label).options.map((option) => option.value)).toEqual(['ask', 'app', 'shell'])
      }
      expect(row('Ctrl+N in a terminal').options.map((option) => option.label)).toEqual([
        'Always ask',
        'Scratchpad',
        'Terminal',
      ])
      expect(row('Ctrl+N in a terminal').get()).toBe('shell')
      expect(row('Ctrl+Space in a terminal').get()).toBe('app')
    } finally {
      for (const command of ['app.scratchpad', 'space.switcher', 'app.close'])
        shells.setWay(command, null)
    }
  })

  test('changes the answer, and asking again takes the row away', () => {
    shells.setWay('app.scratchpad', 'shell')
    row('Ctrl+N in a terminal').set('app')
    expect(shells.ways['app.scratchpad']).toBe('app')

    row('Ctrl+N in a terminal').set('ask')
    expect(shells.ways['app.scratchpad']).toBeUndefined()
    expect(() => row('Ctrl+N in a terminal')).toThrow()
  })

  /** Moved off a key a shell reads, the row says the key the command is on now. */
  test('names the key a command is on now', () => {
    shells.setWay('app.scratchpad', 'app')
    shortcuts.set('app.scratchpad', 'Mod-Shift-y')
    try {
      expect(row('Ctrl+Shift+Y in a terminal').get()).toBe('app')
    } finally {
      shortcuts.reset('app.scratchpad')
      shells.setWay('app.scratchpad', null)
    }
  })
})
