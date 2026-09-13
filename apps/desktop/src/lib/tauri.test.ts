/** Which operating system the app thinks it is on, and what it does when it cannot
 *  tell.
 *
 *  `platform()` is a property read on a global the os plugin's Rust half writes before
 *  the first script runs - read rather than imported, because importing the plugin for
 *  that one line brings the whole IPC core into the first paint; see tauri.ts. A global
 *  read is the one thing that can fail quietly, and this is what stops it: inside the
 *  app an empty answer is a sentence in the console naming the global, so every drive
 *  in test/e2e goes red the day Tauri renames it, and a page in a browser - which has
 *  no such plugin - says nothing at all.
 *
 *  Each case loads the module again with a window of its own, because which build this
 *  is is decided when the module is loaded. */

import { afterEach, describe, expect, test, vi } from 'vitest'

type Tauri = typeof import('./tauri')

/** A page with a Tauri behind it, and whatever the os plugin left on it. */
async function onTauri(os?: { platform?: string }): Promise<Tauri> {
  vi.resetModules()
  ;(globalThis as { window?: unknown }).window = {
    __TAURI_INTERNALS__: {},
    ...(os ? { __TAURI_OS_PLUGIN_INTERNALS__: os } : {}),
  }

  return import('./tauri')
}

/** And a page in a browser, which has neither global. */
async function inBrowser(): Promise<Tauri> {
  vi.resetModules()
  ;(globalThis as { window?: unknown }).window = {}

  return import('./tauri')
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
  vi.restoreAllMocks()
})

describe('which operating system this is', () => {
  test('is what the os plugin wrote on the page', async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { platform, isMobile, isDesktop } = await onTauri({ platform: 'android' })

    expect(platform()).toBe('android')
    expect(isMobile).toBe(true)
    expect(isDesktop).toBe(false)
    expect(said).not.toHaveBeenCalled()
  })

  test('and a desktop is a Tauri page that is not a phone', async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { isMobile, isDesktop } = await onTauri({ platform: 'windows' })

    expect(isMobile).toBe(false)
    expect(isDesktop).toBe(true)
    expect(said).not.toHaveBeenCalled()
  })

  /** The failure this is here for: the plugin gone from the crate, or Tauri renaming
   *  what it writes. Answering the empty string quietly would turn a phone into a
   *  desktop - no share arriving, no dictation row, no widget - with nothing on screen
   *  to say why, so it is said out loud instead, and the sentence names the global so
   *  whoever reads it knows what to look for. */
  test('and a Tauri page that cannot say so writes the global’s name to the console', async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { platform } = await onTauri()

    expect(platform()).toBe('')
    expect(said).toHaveBeenCalled()
    expect(said.mock.calls.flat().join(' ')).toContain('__TAURI_OS_PLUGIN_INTERNALS__')
  })

  test('and so does a Tauri page whose global holds no platform', async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { platform } = await onTauri({})

    expect(platform()).toBe('')
    expect(said.mock.calls.flat().join(' ')).toContain('__TAURI_OS_PLUGIN_INTERNALS__')
  })

  test('while a browser, which has no such plugin, says nothing', async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { platform, isNative } = await inBrowser()

    expect(isNative).toBe(false)
    expect(platform()).toBe('')
    expect(said).not.toHaveBeenCalled()
  })
})
