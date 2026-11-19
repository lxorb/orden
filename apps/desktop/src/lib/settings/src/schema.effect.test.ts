import { describe, expect, test, vi } from 'vitest'
import '../../theme-ports'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
  clear: () => held.clear(),
})
Object.defineProperty(navigator, 'language', { configurable: true, value: 'en-US' })
vi.doMock('../../platform/src/tauri', async (actual) => ({
  ...(await actual<typeof import('../../platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  isMobile: false,
  platform: () => 'linux',
  invoke: () => new Promise(() => undefined),
}))
await import('../../web-tab/src/api')
const { declarations } = await import('./declarations')
const { schemaOf } = await import('./schema')
const fields = await declarations()
const schema = schemaOf(fields)
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
    expect(Object.keys(schema).some((key) => key.startsWith('shortcuts.') && key !== 'shortcuts.vim')).toBe(true)
  })
  test('describes every setting', () => {
    for (const [key, setting] of Object.entries(schema)) expect(setting.description, key).not.toBe('')
  })
})
describe('a shortcut an agent writes', () => {
  test('is turned down where another command already runs that key', () => {
    const italic = fields.find((one) => one.key === 'shortcuts.format-italic')
    if (italic?.kind !== 'text') throw new Error('no italic shortcut')
    expect(italic.check?.('Mod-b')).toContain('already runs')
    expect(italic.check?.('Mod-Alt-F9')).toBeNull()
    expect(italic.check?.('')).toBeNull()
  })
})
describe('a switch of a theme not worn', () => {
  test('reads as its default until something is kept for it', () => {
    const follow = fields.find((one) => one.key === 'themes.glass.follow')
    if (follow?.kind !== 'switch') throw new Error('no glass follow switch')
    expect(follow.get()).toBe(true)
  })
})
