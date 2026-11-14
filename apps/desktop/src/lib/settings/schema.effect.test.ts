import { describe, expect, test, vi } from 'vitest'
import '../theme-ports'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
  clear: () => held.clear(),
})
Object.defineProperty(navigator, 'language', { configurable: true, value: 'en-US' })

vi.doMock('../tauri', async (actual) => ({
  ...(await actual<typeof import('../tauri')>()),
  isDesktop: true,
  isNative: true,
  isMobile: false,
  platform: () => 'linux',
  invoke: () => new Promise(() => undefined),
}))
const { declarations } = await import('./declarations')
const { schemaOf } = await import('./schema')
const schema = schemaOf(await declarations())

describe('the settings’ schema', () => {
  test('has what an agent would set, a list where the app keeps one', () => {
    expect(Object.keys(schema)).toEqual(
      expect.arrayContaining([
        'editor.textSize',
        'appearance.style',
        'appearance.accent',
        'appearance.monoFont',
        'themes.glass.tint',
        'themes.wallpaper.blur',
        'general.searchEngine',
        'kinds.terminal',
        'shortcuts.vim',
        'spelling.languages',
      ]),
    )
    expect(schema['spelling.languages']?.type).toBe('list')
    expect(
      Object.keys(schema).some((key) => key.startsWith('shortcuts.') && key !== 'shortcuts.vim'),
    ).toBe(true)
  })

  test('describes every setting', () => {
    for (const [key, setting] of Object.entries(schema))
      expect(setting.description, key).not.toBe('')
  })
})
