/** The one resolver, on both builds.
 *
 *  `assetUrl` is what every surface that draws a picture goes through - the
 *  editor's widget, the reading view, a hover preview, a card on a plane, a slide
 *  - and the whole point of it is that none of them can tell which build it is in.
 *  So it is asked here twice over, as the app and as a page in a browser, and the
 *  journey back is asked the same way: a document full of addresses has to be
 *  readable as paths again on either.
 *
 *  Which build it is is decided when the module is loaded, from the window, so
 *  each side loads it again with a window of its own. */

import { afterEach, describe, expect, test, vi } from 'vitest'

type Tauri = typeof import('./tauri')

/** How Tauri hands out a file: a host under http where the platform will not give
 *  a webview a scheme of its own, and a scheme where it will. */
const underHttp = (path: string) => `http://asset.localhost/${encodeURIComponent(path)}`
const underScheme = (path: string) => `asset://localhost/${encodeURIComponent(path)}`

async function inBrowser(): Promise<Tauri> {
  vi.resetModules()
  delete (globalThis as { window?: unknown }).window
  return import('./tauri')
}

async function inApp(convertFileSrc: (path: string) => string): Promise<Tauri> {
  vi.resetModules()
  ;(globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: { convertFileSrc } }
  return import('./tauri')
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('a picture, addressed', () => {
  test('the app asks the asset protocol', async () => {
    const { assetUrl, isNative } = await inApp(underHttp)
    expect(isNative).toBe(true)
    expect(assetUrl('C:/Notes/Work/assets/pic.png')).toBe(
      'http://asset.localhost/C%3A%2FNotes%2FWork%2Fassets%2Fpic.png',
    )
  })

  test('a browser asks its own store', async () => {
    const { assetUrl, isNative } = await inBrowser()
    expect(isNative).toBe(false)
    expect(assetUrl('/Work/assets/pic.png')).toBe('/asset/Work/assets/pic.png')
  })

  test('neither build hands back the bare path, which is the bug', async () => {
    // A note-relative path in an `<img>` is asked of the page's own origin, and
    // that is what never drew: whatever comes out here, it is an address.
    const browser = await inBrowser()
    expect(browser.assetUrl('/Work/assets/pic.png')).not.toBe('/Work/assets/pic.png')

    const app = await inApp(underHttp)
    expect(app.assetUrl('C:/Notes/Work/assets/pic.png')).not.toBe('C:/Notes/Work/assets/pic.png')
  })

  test('a path with a space or a hash in it survives either way', async () => {
    const browser = await inBrowser()
    expect(browser.assetUrl('/Read me/a#b.png')).toBe('/asset/Read%20me/a%23b.png')

    const app = await inApp(underHttp)
    expect(app.assetUrl('C:/Read me/a#b.png')).toBe(
      'http://asset.localhost/C%3A%2FRead%20me%2Fa%23b.png',
    )
  })
})

describe('and read back', () => {
  test('the app reads its own protocol, both shapes of it', async () => {
    const { assetPath } = await inApp(underHttp)
    expect(assetPath(underHttp('C:/Notes/Work/assets/pic.png'))).toBe(
      'C:/Notes/Work/assets/pic.png',
    )
    expect(assetPath(underScheme('/Users/emil/Notes/pic.png'))).toBe('/Users/emil/Notes/pic.png')
  })

  test('a browser reads the route back to the row it names', async () => {
    const { assetPath, assetUrl } = await inBrowser()
    expect(assetPath(assetUrl('/Work/assets/pic.png'))).toBe('/Work/assets/pic.png')
    expect(assetPath(assetUrl('/Read me/a#b.png'))).toBe('/Read me/a#b.png')
  })

  test('neither reads an address it did not make', async () => {
    for (const build of [await inBrowser(), await inApp(underHttp)]) {
      expect(build.assetPath('assets/pic.png')).toBeNull()
      expect(build.assetPath('https://example.com/pic.png')).toBeNull()
      expect(build.assetPath('data:image/png;base64,AA')).toBeNull()
    }
  })
})

describe('a picture a note names', () => {
  test('resolves from the note it is beside, on either build', async () => {
    vi.resetModules()
    delete (globalThis as { window?: unknown }).window
    const { imageUrl } = await import('./images')
    expect(imageUrl('assets/pic.png', '/Work/Q1.md')).toBe('/asset/Work/assets/pic.png')
    // One folder down, pointing at the space's own assets folder, which is what
    // the Attachments setting writes.
    expect(imageUrl('../assets/pic.png', '/Work/notes/Q1.md')).toBe('/asset/Work/assets/pic.png')
  })

  test('and one off the network is left where it points', async () => {
    vi.resetModules()
    delete (globalThis as { window?: unknown }).window
    const { imageUrl } = await import('./images')
    expect(imageUrl('https://example.com/pic.png', '/Work/Q1.md')).toBe(
      'https://example.com/pic.png',
    )
  })
})
