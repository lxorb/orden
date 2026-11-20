import { describe, expect, test } from 'vitest'
import {
  APP_ORIGIN,
  cueOf,
  DEMO_PHONE_SRC,
  DEMO_SCENES,
  DEMO_SRC,
  downloadFor,
  frameOf,
  isDemoCue,
  isDemoReady,
  LATEST_RELEASE,
  LATEST_RELEASE_API,
  originsAt,
  releaseAssets,
  siteAnswer,
  siteFiles,
  SITE_ORIGIN,
  storyAt,
  type DemoCue,
} from '../src/api'

const TRACK = { rise: 900, span: 1350 }
const END = TRACK.rise + DEMO_SCENES.length * TRACK.span
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'
const LINUX_ARM = 'Mozilla/5.0 (X11; Linux aarch64; rv:132.0) Gecko/20100101 Firefox/132.0'
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36'
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const asset = (name: string) => `https://github.com/lxorb/orden/releases/download/v0.21.1/Orden-0.21.1-${name}`
const NAMES = [
  'latest.json',
  'Orden-0.21.1-android.apk',
  'Orden-0.21.1-linux-arm64.AppImage',
  'Orden-0.21.1-linux-arm64.deb',
  'Orden-0.21.1-linux-x64.AppImage',
  'Orden-0.21.1-linux-x64.rpm',
  'Orden-0.21.1-macos-universal.dmg',
  'Orden-0.21.1-windows-arm64-setup.exe',
  'Orden-0.21.1-windows-arm64.msi',
  'Orden-0.21.1-windows-x64-setup.exe',
  'Orden-0.21.1-windows-x64.msi',
]
const ASSETS = releaseAssets({
  tag_name: 'v0.21.1',
  assets: NAMES.map((name) => ({
    name,
    browser_download_url: `https://github.com/lxorb/orden/releases/download/v0.21.1/${name}`,
  })),
})
describe('the cue the home page sends its demo', () => {
  test('names each scene the demo plays, in the order the page tells them', () => {
    expect(DEMO_SCENES).toEqual(['canvas', 'write', 'browse', 'organize', 'overview'])
    expect(DEMO_SRC).toBe('/?demo')
    expect(DEMO_PHONE_SRC).toBe('/?demo=phone')
  })
  test('is read only when it is one, whole', () => {
    const cue: DemoCue = { orden: 'demo', scene: 'write', at: 0.4, still: false }
    expect(isDemoCue(cue)).toBe(true)
    expect(isDemoCue({ orden: 'demo', scene: 'canvas', at: 0 })).toBe(true)
    for (const wrong of [
      null,
      'canvas',
      { orden: 'demo', scene: 'chat', at: 0.4 },
      { orden: 'demo', scene: 'write', at: 1.2 },
      { orden: 'demo', scene: 'write', at: -0.1 },
      { orden: 'demo', scene: 'write', at: Number.NaN },
      { orden: 'demo', scene: 'write', at: 0.4, still: 'yes' },
      { orden: 'other', scene: 'write', at: 0.4 },
    ])
      expect(isDemoCue(wrong)).toBe(false)
  })
  test('hears the demo say it is ready, and nothing else', () => {
    expect(isDemoReady({ orden: 'demo', ready: true })).toBe(true)
    expect(isDemoReady({ orden: 'demo', ready: 'yes' })).toBe(false)
    expect(isDemoReady({ ready: true })).toBe(false)
  })
  test('is a cue the demo accepts at every point of the page, still or moving', () => {
    for (let scrolled = -200; scrolled <= END + 2000; scrolled += 37) {
      for (const still of [false, true]) {
        const cue = cueOf(storyAt(scrolled, TRACK), still)
        expect(isDemoCue(cue), String(scrolled)).toBe(true)
        expect(cue.still).toBe(still)
      }
    }
  })
})
describe('the story the page scrolls through', () => {
  test('opens on the canvas while the window rises', () => {
    expect(storyAt(0, TRACK)).toMatchObject({ scene: 'canvas', at: 0, rise: 0 })
    expect(storyAt(TRACK.rise / 2, TRACK)).toMatchObject({ scene: 'canvas', at: 0, rise: 0.5 })
  })
  test('starts each chapter where its section starts and ends on the overview', () => {
    DEMO_SCENES.forEach((scene, index) => {
      const start = TRACK.rise + index * TRACK.span
      expect(storyAt(start, TRACK)).toMatchObject({ scene, at: 0, rise: 1 })
      expect(storyAt(start + TRACK.span / 2, TRACK)).toMatchObject({ scene, at: 0.5 })
    })
    expect(storyAt(END + 500, TRACK)).toMatchObject({ scene: 'overview', at: 1 })
  })
  test('shows a chapter line in full where its section starts, and one line at a time', () => {
    DEMO_SCENES.forEach((_scene, index) => {
      const frame = frameOf(storyAt(TRACK.rise + index * TRACK.span, TRACK), false)
      expect(frame.captions[index]).toBe(1)
    })
    for (let scrolled = 0; scrolled <= END; scrolled += 23) {
      const shown = frameOf(storyAt(scrolled, TRACK), false).captions.filter((one) => one > 0.5)
      expect(shown.length, String(scrolled)).toBeLessThanOrEqual(1)
    }
  })
  test('brings the buttons back only at the end', () => {
    expect(frameOf(storyAt(TRACK.rise + 4 * TRACK.span, TRACK), false).close).toBe(0)
    expect(frameOf(storyAt(END, TRACK), false).close).toBe(1)
    expect(frameOf(storyAt(END, TRACK), true).close).toBe(1)
  })
  test('holds still frames when motion is reduced', () => {
    for (let scrolled = 0; scrolled <= END; scrolled += 41) {
      const frame = frameOf(storyAt(scrolled, TRACK), true)
      expect(frame.lift).toBe(1)
      expect(frame.hero).toBe(1)
      for (const value of [...frame.captions, frame.shrink, frame.close]) expect([0, 1]).toContain(value)
    }
  })
})
describe('the download button', () => {
  test('offers the latest release file for the system the visitor is on, found by its ending', () => {
    expect(downloadFor({ userAgent: MAC }, ASSETS)).toEqual({
      label: 'Download for macOS',
      href: asset('macos-universal.dmg'),
    })
    expect(downloadFor({ userAgent: WINDOWS }, ASSETS)).toEqual({
      label: 'Download for Windows',
      href: asset('windows-x64-setup.exe'),
    })
    expect(downloadFor({ userAgent: WINDOWS, architecture: 'arm' }, ASSETS).href).toBe(asset('windows-arm64-setup.exe'))
    expect(downloadFor({ userAgent: LINUX }, ASSETS)).toEqual({
      label: 'Download for Linux',
      href: asset('linux-x64.AppImage'),
    })
    expect(downloadFor({ userAgent: LINUX_ARM }, ASSETS).href).toBe(asset('linux-arm64.AppImage'))
    expect(downloadFor({ userAgent: ANDROID }, ASSETS)).toEqual({
      label: 'Download for Android',
      href: asset('android.apk'),
    })
  })
  test('names the system before the release is known, and links the release page meanwhile', () => {
    expect(downloadFor({ userAgent: MAC })).toEqual({ label: 'Download for macOS', href: LATEST_RELEASE })
    expect(downloadFor({ userAgent: LINUX }, releaseAssets(null))).toEqual({
      label: 'Download for Linux',
      href: LATEST_RELEASE,
    })
  })
  test('sends anyone it has no file for to the latest release', () => {
    const latest = { label: 'Download', href: LATEST_RELEASE }
    expect(downloadFor({ userAgent: IPHONE }, ASSETS)).toEqual(latest)
    expect(downloadFor({ userAgent: MAC, touchPoints: 5 }, ASSETS)).toEqual(latest)
    expect(downloadFor({ userAgent: 'curl/8.0' }, ASSETS)).toEqual(latest)
  })
  test('takes nothing from a release but its own files', () => {
    const elsewhere = releaseAssets({
      assets: [{ name: 'Orden-9.9.9-macos-universal.dmg', browser_download_url: 'https://example.com/x.dmg' }],
    })
    expect(downloadFor({ userAgent: MAC }, elsewhere).href).toBe(LATEST_RELEASE)
    expect(releaseAssets({ assets: [{ name: 1 }, null, 'x'] })).toEqual([])
    expect(releaseAssets('not json')).toEqual([])
    expect(LATEST_RELEASE_API).toBe('https://api.github.com/repos/lxorb/orden/releases/latest')
  })
})
describe('the two addresses', () => {
  test('orden.so is the site and app.orden.so the app, seen from either', () => {
    expect(SITE_ORIGIN).toBe('https://orden.so')
    expect(APP_ORIGIN).toBe('https://app.orden.so')
    for (const hostname of ['orden.so', 'app.orden.so'])
      expect(originsAt({ origin: `https://${hostname}`, hostname })).toEqual({ site: SITE_ORIGIN, app: APP_ORIGIN })
  })
  test('anywhere else, such as a preview, the page and the app share one origin', () => {
    const preview = { origin: 'http://127.0.0.1:4791', hostname: '127.0.0.1' }
    expect(originsAt(preview)).toEqual({ site: preview.origin, app: preview.origin })
  })
})
describe('the site Worker on orden.so', () => {
  const page = '<!doctype html><title>Orden</title>'
  const assets = {
    fetch: (request: Request) =>
      Promise.resolve(
        new URL(request.url).pathname === '/'
          ? new Response(page, { headers: { 'content-type': 'text/html' } })
          : new Response('Not found', { status: 404 }),
      ),
  }
  const answer = (url: string, method = 'GET') => siteAnswer(new Request(url, { method }), assets)
  test('shows the home page at the root, and lets nobody frame it', async () => {
    const shown = await answer('https://orden.so/')
    expect(shown.status).toBe(200)
    expect(await shown.text()).toBe(page)
    expect(shown.headers.get('content-security-policy')).toBe("frame-ancestors 'none'")
    expect(shown.headers.get('x-frame-options')).toBe('DENY')
  })
  test('sends every old link into the app at app.orden.so, path and query kept', async () => {
    for (const [from, to] of [
      ['https://orden.so/?channel=unstable', 'https://app.orden.so/?channel=unstable'],
      ['https://orden.so/?demo', 'https://app.orden.so/?demo'],
      ['https://orden.so/join/abc', 'https://app.orden.so/join/abc'],
      ['https://orden.so/pass-link/xyz', 'https://app.orden.so/pass-link/xyz'],
    ] as const) {
      const sent = await answer(from)
      expect(sent.status, from).toBe(301)
      expect(sent.headers.get('location'), from).toBe(to)
    }
    expect((await answer('https://orden.so/', 'POST')).status).toBe(308)
  })
  test('keeps its built files for a year, by name', () => {
    expect(siteFiles()._headers).toContain('/home/*')
    expect(siteFiles()._headers).toContain('immutable')
  })
})
