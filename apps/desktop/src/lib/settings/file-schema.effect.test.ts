import { describe, expect, test, vi } from 'vitest'

/** The settings file's schema (#673), which packaging/nix/settings-schema.json holds
 *  for Home Manager to make `programs.orden.settings` from. Made here from the fields
 *  that declare it (declarations.ts) as each desktop builds them, Linux, macOS and
 *  Windows, and merged into one, each setting that is not on all three saying where it
 *  is. A field given a key, or a key's choices changed, without the file following fails
 *  here, and `vitest -u` writes it again. In the jsdom project because the themes'
 *  settings are worked out against the page. */

import type { Field } from './fields'
import type { Platform, Schema } from './file-schema'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
  clear: () => held.clear(),
})
Object.defineProperty(navigator, 'language', { configurable: true, value: 'en-US' })

/** The fields one desktop declares, built afresh for it. The DNS row is offered, and
 *  its provider's too, as they are once somebody picks another provider. */
async function fieldsOn(platform: Platform): Promise<{ fields: Field[]; schema: Schema }> {
  vi.resetModules()
  held.clear()
  vi.doMock('../tauri', async (actual) => ({
    ...(await actual<typeof import('../tauri')>()),
    isDesktop: true,
    isNative: true,
    isMobile: false,
    platform: () => platform,
    invoke: (command: string) =>
      command === 'dns_chosen'
        ? Promise.resolve({ choice: 'custom', custom: '' })
        : new Promise(() => undefined),
  }))
  const { dns } = await import('./dns.svelte')
  await dns.ask()
  const { declarations } = await import('./declarations')
  const { schemaOf } = await import('./file-schema')
  const fields = await declarations()
  return { fields, schema: schemaOf(fields) }
}

const each = {
  linux: await fieldsOn('linux'),
  macos: await fieldsOn('macos'),
  windows: await fieldsOn('windows'),
}
const { mergedSchema } = await import('./file-schema')
const schema = mergedSchema({
  linux: each.linux.schema,
  macos: each.macos.schema,
  windows: each.windows.schema,
})

describe('the settings file’s schema', () => {
  test('is what the fields declare on every desktop, as the flake has it', async () => {
    await expect(`${JSON.stringify(schema, null, 2)}\n`).toMatchFileSnapshot(
      '../../../../../packaging/nix/settings-schema.json',
    )
  })

  test('has what a configuration would set, a list where the app keeps one', () => {
    expect(Object.keys(schema)).toEqual(
      expect.arrayContaining([
        'editor.textSize',
        'appearance.style',
        'appearance.accent',
        'appearance.monoFont',
        'themes.glass.tint',
        'themes.wallpaper.blur',
        'general.dns',
        'general.dnsProvider',
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

  test('says which platforms a setting is on, where it is not on all of them', () => {
    // Glass's material is what Windows draws behind the window.
    expect(schema['themes.glass.material']?.platforms).toEqual(['windows'])
    expect(schema['editor.textSize']?.platforms).toBeUndefined()
  })

  test('has no key that is the start of another, which Nix could not nest', () => {
    const keys = Object.keys(schema)
    const clashes = keys.filter((one) => keys.some((other) => other.startsWith(`${one}.`)))
    expect(clashes).toEqual([])
  })

  test('holds every setting where it is kept, a property each store has', () => {
    for (const { fields } of Object.values(each)) {
      for (const one of fields) {
        expect(one.store, one.key).toBeDefined()
        if (one.store) expect(one.store.name in one.store.on, one.key).toBe(true)
      }
    }
  })

  test('describes every setting', () => {
    for (const [key, setting] of Object.entries(schema))
      expect(setting.description, key).not.toBe('')
  })
})
