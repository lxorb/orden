import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  ageInWords,
  APP_ORIGIN,
  appHomeAt,
  DEMO_LOOP_SCENES,
  DEMO_PHONE_SRC,
  DEMO_SCENES,
  DEMO_SRC,
  demoLoopSrc,
  downloadFor,
  isDemoCue,
  isDemoLoopScene,
  isDemoPlay,
  isDemoReady,
  LATEST_RELEASE,
  LATEST_RELEASE_API,
  originsAt,
  poolOf,
  previewAnswer,
  releaseAssets,
  releasedAt,
  siteAnswer,
  siteFiles,
  SITE_ORIGIN,
  type DemoCue,
  type DemoPlay,
  type Visitor,
} from '../src/api'

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
})
describe('the loops the home page shows', () => {
  test('name the hero workflow first and then each feature, each at its own address', () => {
    expect(DEMO_LOOP_SCENES).toEqual([
      'flow',
      'canvas',
      'markdown',
      'pages',
      'bubbles',
      'ai',
      'todos',
      'chat',
      'search',
    ])
    expect(demoLoopSrc('flow', false)).toBe('/?demo=flow&loop')
    expect(demoLoopSrc('chat', true)).toBe('/?demo=chat&loop&phone')
    expect(isDemoLoopScene('search')).toBe(true)
    expect(isDemoLoopScene('write')).toBe(false)
  })
  test('are told to play, to pause or to hold still, one at a time', () => {
    const told: DemoPlay[] = [
      { orden: 'demo', play: true },
      { orden: 'demo', play: false },
      { orden: 'demo', still: true },
    ]
    for (const one of told) expect(isDemoPlay(one)).toBe(true)
    for (const wrong of [
      null,
      { orden: 'demo' },
      { orden: 'demo', play: 'yes' },
      { orden: 'demo', still: false },
      { orden: 'demo', play: true, still: true },
      { orden: 'other', play: true },
    ])
      expect(isDemoPlay(wrong)).toBe(false)
  })
})
describe('the pool of live displays', () => {
  const HEIGHT = 900
  const at = (top: number, tall = 600) => ({ top, bottom: top + tall })
  test('loads up to the given number, nearest the screen first, reaching two screens ahead', () => {
    const spans = [at(-2400), at(-1200), at(150), at(1000), at(2200), at(3400)]
    expect(poolOf(spans, HEIGHT, 4)).toEqual({ live: [2, 3, 1, 4], playing: [2] })
    expect(poolOf(spans, HEIGHT, 2).live).toEqual([2, 3])
    expect(poolOf(spans, HEIGHT, 0)).toEqual({ live: [], playing: [] })
  })
  test('starts the displays below well before they come into view', () => {
    expect(poolOf([at(0), at(2400)], HEIGHT, 4).live).toEqual([0, 1])
    expect(poolOf([at(0), at(2800)], HEIGHT, 4).live).toEqual([0])
  })
  test('keeps what it has loaded warm a while after it scrolls past, and lets it go far away', () => {
    const spans = [at(-2600), at(200)]
    expect(poolOf(spans, HEIGHT, 4).live).toEqual([1])
    expect(poolOf(spans, HEIGHT, 4, [0, 1]).live).toEqual([1, 0])
    expect(poolOf([at(-4000), at(200)], HEIGHT, 4, [0, 1]).live).toEqual([1])
    expect(poolOf(spans, HEIGHT, 1, [0, 1]).live).toEqual([1])
  })
  test('lets everything far off the screen rest as a poster', () => {
    expect(poolOf([at(-5000), at(5000)], HEIGHT, 4).live).toEqual([])
    expect(poolOf([at(200, 0)], HEIGHT, 4).live).toEqual([])
  })
  test('never runs more than asked and plays only what is on screen, at any point of a long page', () => {
    const spans = Array.from({ length: 9 }, (_, index) => at(index * 1100))
    let held: number[] = []
    for (let scrolled = -500; scrolled < 9000; scrolled += 53) {
      const moved = spans.map(({ top, bottom }) => ({ top: top - scrolled, bottom: bottom - scrolled }))
      const { live, playing } = poolOf(moved, HEIGHT, 3, held)
      expect(live.length, String(scrolled)).toBeLessThanOrEqual(3)
      expect(playing.length, String(scrolled)).toBeGreaterThan(0)
      for (const index of playing) {
        expect(live).toContain(index)
        const span = moved[index]
        expect(span && span.bottom > 0 && span.top < HEIGHT).toBe(true)
      }
      held = live
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
  test('sends anyone it has no file for to the latest release, and an iPhone or iPad to the web app', () => {
    const latest = { label: 'Download', href: LATEST_RELEASE }
    const web = { label: 'Open the web app', href: `${APP_ORIGIN}/` }
    expect(downloadFor({ userAgent: IPHONE }, ASSETS)).toEqual(web)
    expect(downloadFor({ userAgent: MAC, touchPoints: 5 }, ASSETS)).toEqual(web)
    expect(downloadFor({ userAgent: IPHONE }, ASSETS, 'https://orden.so/preview/app/').href).toBe(
      'https://orden.so/preview/app/',
    )
    expect(downloadFor({ userAgent: 'curl/8.0' }, ASSETS)).toEqual(latest)
  })
  test('tells each real browser its own system, phones and tablets before the desktops their agents name', () => {
    const real: [string, Visitor, string][] = [
      ['Windows, Chrome', { userAgent: WINDOWS }, 'Download for Windows'],
      ['macOS, Safari', { userAgent: MAC }, 'Download for macOS'],
      ['Linux, Chrome', { userAgent: LINUX }, 'Download for Linux'],
      ['Linux laptop with a touch screen', { userAgent: LINUX, touchPoints: 10, coarse: false }, 'Download for Linux'],
      ['Android, Chrome', { userAgent: ANDROID, touchPoints: 5, coarse: true }, 'Download for Android'],
      [
        'Android, Chrome reduced agent',
        {
          userAgent:
            'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
          platform: 'Android',
        },
        'Download for Android',
      ],
      [
        'Android, Samsung Internet',
        {
          userAgent:
            'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
        },
        'Download for Android',
      ],
      [
        'Android, Firefox',
        { userAgent: 'Mozilla/5.0 (Android 15; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0' },
        'Download for Android',
      ],
      [
        'Android, Chrome asking for the desktop site',
        { userAgent: LINUX, touchPoints: 5, coarse: true },
        'Download for Android',
      ],
      ['Android, desktop agent but platform said', { userAgent: LINUX, platform: 'Android' }, 'Download for Android'],
      ['iPhone, Safari', { userAgent: IPHONE, touchPoints: 5, coarse: true }, 'Open the web app'],
      [
        'iPad, Safari on an old iPadOS',
        {
          userAgent:
            'Mozilla/5.0 (iPad; CPU OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
        },
        'Open the web app',
      ],
      ['iPad, Safari with its desktop agent', { userAgent: MAC, touchPoints: 5, coarse: true }, 'Open the web app'],
      [
        'Chromebook',
        {
          userAgent:
            'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
        'Download',
      ],
      ['Chromebook, platform said', { userAgent: LINUX, platform: 'Chrome OS' }, 'Download'],
    ]
    for (const [name, visitor, label] of real) expect(downloadFor(visitor, ASSETS).label, name).toBe(label)
    expect(downloadFor({ userAgent: ANDROID }, ASSETS).href).toBe(asset('android.apk'))
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
describe('the age of the latest release', () => {
  test('is read from the release, and from nothing else', () => {
    expect(releasedAt({ published_at: '2026-11-21T11:12:54Z' })?.toISOString()).toBe('2026-11-21T11:12:54.000Z')
    for (const wrong of [null, 'x', {}, { published_at: 5 }, { published_at: 'soon' }])
      expect(releasedAt(wrong)).toBe(null)
  })
  test('is told in days, with today and yesterday by name', () => {
    const at = new Date('2026-11-21T11:00:00Z')
    expect(ageInWords(at, new Date('2026-11-21T23:00:00Z'))).toBe('today')
    expect(ageInWords(at, new Date('2026-11-22T12:00:00Z'))).toBe('yesterday')
    expect(ageInWords(at, new Date('2026-11-27T12:00:00Z'))).toBe('6 days ago')
    expect(ageInWords(at, new Date('2026-11-20T12:00:00Z'))).toBe('today')
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
  test('the page finds the app at app.orden.so, or beside itself when built under a path', () => {
    const site = { origin: 'https://orden.so', hostname: 'orden.so' }
    expect(appHomeAt(site, '/')).toEqual({ origin: APP_ORIGIN, home: APP_ORIGIN })
    expect(appHomeAt(site, '/preview/')).toEqual({ origin: SITE_ORIGIN, home: 'https://orden.so/preview/app' })
    const local = { origin: 'http://127.0.0.1:4791', hostname: '127.0.0.1' }
    expect(appHomeAt(local, '/')).toEqual({ origin: local.origin, home: local.origin })
    expect(appHomeAt(local, '/preview')).toEqual({ origin: local.origin, home: `${local.origin}/preview/app` })
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
describe('the preview Worker on orden.so/preview/', () => {
  const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html' } })
  const files: Record<string, () => Response> = {
    '/preview/': () => html('page'),
    '/preview/app/': () => html('app'),
    '/preview/app/handoff': () => html('handoff'),
    '/preview/app/demo/web/kestrel.html': () => html('kestrel'),
    '/preview/app/assets/main.js': () => new Response('code', { headers: { 'content-type': 'text/javascript' } }),
  }
  const seen: string[] = []
  const assets = {
    fetch: (request: Request) => {
      const { pathname } = new URL(request.url)
      seen.push(pathname)
      return Promise.resolve(files[pathname]?.() ?? new Response('Not found', { status: 404 }))
    },
  }
  const answer = (url: string, method = 'GET') => previewAnswer(new Request(url, { method }), assets)
  test('shows the new page and its demos to nobody but itself, and to no search engine', async () => {
    for (const url of [
      'https://orden.so/preview/',
      'https://orden.so/preview/app/?demo=flow&loop',
      'https://orden.so/preview/app/demo/web/kestrel.html',
      'https://orden.so/preview/app/assets/main.js',
    ]) {
      const shown = await answer(url)
      expect(shown.status, url).toBe(200)
      expect(shown.headers.get('x-robots-tag'), url).toContain('noindex')
      expect(shown.headers.get('content-security-policy'), url).toBe("frame-ancestors 'self'")
    }
  })
  test('opens the app only as the demo, so the real app never runs on the site', async () => {
    for (const url of ['https://orden.so/preview/app/', 'https://orden.so/preview/app/handoff']) {
      const sent = await answer(url)
      expect(sent.status, url).toBe(302)
      expect(sent.headers.get('location'), url).toBe('https://orden.so/preview/')
    }
  })
  test('answers nothing outside its path and only reads', async () => {
    seen.length = 0
    expect((await answer('https://orden.so/')).status).toBe(404)
    expect((await answer('https://orden.so/previewed')).status).toBe(404)
    expect(seen).toEqual([])
    expect((await answer('https://orden.so/preview/', 'POST')).status).toBe(405)
    const bare = await answer('https://orden.so/preview')
    expect(bare.status).toBe(301)
    expect(bare.headers.get('location')).toBe('https://orden.so/preview/')
  })
})
describe('what the module carries', () => {
  const SOURCE = new URL('../src/', import.meta.url)
  test('no style and no font, so a module that imports its api keeps the page styles out of the app', () => {
    const code = readdirSync(SOURCE).filter((name) => name.endsWith('.ts') && !name.includes('.test.'))
    expect(code).toContain('api.ts')
    for (const name of code)
      expect(readFileSync(new URL(name, SOURCE), 'utf8'), name).not.toMatch(
        /import\s+['"][^'"]*(?:\.css|@fontsource[^'"]*)['"]/,
      )
  })
  test('the page styles are imported by the home page entry alone, so no app chunk can carry them', () => {
    const app = new URL('../../../', SOURCE).pathname
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return files(path)
        return /\.(?:ts|svelte|js)$/.test(name) && !name.includes('.test.') ? [path] : []
      })
    const takers = files(app).filter((path) => /home\.css['"]/.test(readFileSync(path, 'utf8')))
    expect(takers.map((path) => path.slice(app.length))).toEqual(['home.ts'])
  })
  test('the api reaches the page code only through a lazy door', () => {
    const api = readFileSync(new URL('api.ts', SOURCE), 'utf8')
    expect(api).not.toMatch(/from '\.\/home-page'/)
    expect(api).toContain("import('./home-page')")
  })
  test('the home page entry brings the page styles and its font itself', () => {
    const entry = readFileSync(new URL('../../../home.ts', SOURCE), 'utf8')
    expect(entry).toContain("import './lib/showcase/src/home.css'")
    expect(entry).toContain("import '@fontsource-variable/geist'")
  })
})
