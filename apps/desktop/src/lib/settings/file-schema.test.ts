import { expect, test, vi } from 'vitest'

/** The settings file's schema (#673), which packaging/nix/settings-schema.json holds
 *  for Home Manager to make `programs.orden.settings` from. Made here from the panes as
 *  a Linux desktop builds them, since that is the one the flake is for; a field given a
 *  key, or a key's choices changed, without the file following fails here, and
 *  `vitest -u` writes it again. */

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
})
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', language: 'en' })

vi.mock('../tauri', async (actual) => ({
  ...(await actual<typeof import('../tauri')>()),
  isDesktop: true,
  isNative: true,
  platform: () => 'linux',
  // The engine is nib's own Chromium, so DNS is a row; nothing else answers, so what
  // else a pane asks the crate for as it is drawn stays unasked.
  invoke: (command: string) =>
    command === 'dns_chosen'
      ? Promise.resolve({ choice: 'automatic', custom: '' })
      : new Promise(() => undefined),
}))

const { declaredPanes } = await import('../preferences')
const { schemaOf } = await import('./file-schema')
const { dns } = await import('./dns.svelte')
await dns.ask()

test('is what the panes declare, as the flake has it', async () => {
  const schema = schemaOf(declaredPanes())
  await expect(`${JSON.stringify(schema, null, 2)}\n`).toMatchFileSnapshot(
    '../../../../../packaging/nix/settings-schema.json',
  )
})

test('names every setting a configuration would want, and each once', () => {
  const schema = schemaOf(declaredPanes())
  expect(Object.keys(schema)).toEqual(
    expect.arrayContaining([
      'editor.textSize',
      'editor.focusMode',
      'markdown.strictCommonMark',
      'appearance.style',
      'appearance.mode',
      'appearance.monoFont',
      'general.language',
      'general.dns',
      'general.shell',
      'export.paper',
    ]),
  )
  for (const [key, setting] of Object.entries(schema)) {
    expect(key, key).toMatch(/^[a-z]+\.[a-zA-Z]+$/)
    expect(setting.description, key).not.toBe('')
  }
})
