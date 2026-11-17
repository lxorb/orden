import { afterEach, describe, expect, test, vi } from 'vitest'

type Tauri = typeof import('./tauri')

async function onTauri(os?: { platform?: string }): Promise<Tauri> {
  vi.resetModules()
  ;(globalThis as { window?: unknown }).window = {
    __TAURI_INTERNALS__: {},
    ...(os ? { __TAURI_OS_PLUGIN_INTERNALS__: os } : {}),
  }

  return import('./tauri')
}

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

describe('a link out of the app', () => {
  afterEach(() => {
    vi.doUnmock('@tauri-apps/plugin-opener')
  })

  test('on a phone is the system’s to open, in the browser it chose', async () => {
    const opened: string[] = []
    vi.doMock('@tauri-apps/plugin-opener', () => ({
      openUrl: (url: string) => {
        opened.push(url)
        return Promise.resolve()
      },
    }))
    const { openExternal } = await onTauri({ platform: 'android' })

    await openExternal('https://example.com/site')

    expect(opened).toEqual(['https://example.com/site'])
  })

  test('in a browser is a new tab', async () => {
    const tabs: unknown[][] = []
    const { openExternal } = await inBrowser()
    ;(window as unknown as { open: (...args: unknown[]) => void }).open = (...args) =>
      void tabs.push(args)

    await openExternal('https://example.com/site')

    expect(tabs).toEqual([['https://example.com/site', '_blank', 'noopener']])
  })
})
