import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import PAGE from '../../../../home.html?raw'
import { elapse } from '../../../../test/effects/settle'
import { DEMO_LOOP_SCENES } from './demo-cue'
import { showHome } from './home-page'

const BODY = /<body>([\s\S]*)<\/body>/.exec(PAGE)?.[1] ?? ''
function media(matching: string[]) {
  return (query: string) =>
    ({
      matches: matching.includes(query),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList
}
const displays = () => [...document.querySelectorAll<HTMLElement>('.display')]
function placeAt(scrolled: number) {
  displays().forEach((box, index) => {
    const top = index * 1000 - scrolled
    vi.spyOn(box, 'getBoundingClientRect').mockReturnValue({ top, bottom: top + 600 } as DOMRect)
  })
  window.dispatchEvent(new Event('scroll'))
}
function frameIn(index: number) {
  const frame = displays()[index]?.querySelector<HTMLIFrameElement>('iframe.demo') ?? null
  if (!frame?.contentWindow) return null
  return {
    frame,
    inside: frame.contentWindow,
    said: vi.spyOn(frame.contentWindow, 'postMessage').mockImplementation(() => undefined),
  }
}
function live(index: number) {
  const found = frameIn(index)
  if (!found) throw new Error(`no demo in display ${index}`)
  return found
}
function sayReady(source: Window | null, origin = location.origin) {
  window.dispatchEvent(new MessageEvent('message', { data: { orden: 'demo', ready: true }, origin, source }))
}
beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = BODY
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('offline'))),
  )
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
    run(0)
    return 1
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})
describe('the home page', () => {
  test('follows the system theme', () => {
    vi.stubGlobal('matchMedia', media(['(prefers-color-scheme: light)']))
    showHome(window)
    expect(document.documentElement.dataset.theme).toBe('light')
  })
  test('points both Download buttons at the file for this system once the release is read, and Try it out at the app', async () => {
    vi.stubGlobal('matchMedia', media([]))
    vi.spyOn(Object.getPrototypeOf(navigator) as Navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    )
    const file = 'https://github.com/lxorb/orden/releases/download/v0.21.1/Orden-0.21.1-windows-x64-setup.exe'
    const asked = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            assets: [
              { name: 'Orden-0.21.1-windows-x64.msi', browser_download_url: file.replace('-setup.exe', '.msi') },
              { name: 'Orden-0.21.1-windows-x64-setup.exe', browser_download_url: file },
            ],
          }),
        ),
      ),
    )
    vi.stubGlobal('fetch', asked)
    showHome(window)
    const downloads = [...document.querySelectorAll<HTMLAnchorElement>('a[data-download]')]
    expect(downloads).toHaveLength(2)
    for (const link of downloads) {
      expect(link.querySelector('[data-label]')?.textContent).toBe('Download for Windows')
      expect(link.href).toBe('https://github.com/lxorb/orden/releases/latest')
    }
    expect(asked).not.toHaveBeenCalled()
    await elapse(1000)
    expect(asked.mock.calls[0]?.[0]).toBe('https://api.github.com/repos/lxorb/orden/releases/latest')
    for (const link of downloads) expect(link.href).toBe(file)
    const apps = [...document.querySelectorAll<HTMLAnchorElement>('a[data-app]')]
    expect(apps).toHaveLength(2)
    for (const link of apps) expect(link.getAttribute('href')).toBe(`${location.origin}/`)
  })
  test('keeps the release page when the release cannot be read', async () => {
    vi.stubGlobal('matchMedia', media([]))
    showHome(window)
    await elapse(1000)
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a[data-download]'))
      expect(link.href).toBe('https://github.com/lxorb/orden/releases/latest')
  })
  test('loads no demo until the page has gone idle, then only the two nearest the screen, as phones on a phone', () => {
    vi.stubGlobal('matchMedia', media(['(max-width: 719.98px)']))
    showHome(window, '/')
    placeAt(0)
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
    vi.advanceTimersByTime(1000)
    const frames = [...document.querySelectorAll<HTMLIFrameElement>('iframe.demo')]
    expect(frames.map((one) => one.getAttribute('src'))).toEqual([
      `${location.origin}/?demo=flow&loop&phone`,
      `${location.origin}/?demo=canvas&loop&phone`,
    ])
    for (const frame of frames) {
      expect(frame.hasAttribute('inert')).toBe(true)
      expect(frame.tabIndex).toBe(-1)
      expect(frame.getAttribute('aria-hidden')).toBe('true')
    }
  })
  test('shows a demo once it says it is ready, pauses it off screen and hands its place on far away', () => {
    vi.stubGlobal('matchMedia', media([]))
    showHome(window, '/')
    placeAt(0)
    vi.advanceTimersByTime(1000)
    const hero = live(0)
    const next = live(1)
    sayReady(next.inside, 'https://elsewhere.example')
    sayReady(window)
    expect(displays()[1]?.classList.contains('is-ready')).toBe(false)
    sayReady(next.inside)
    expect(displays()[1]?.classList.contains('is-ready')).toBe(true)
    expect(next.said).toHaveBeenLastCalledWith({ orden: 'demo', play: false }, location.origin)
    sayReady(hero.inside)
    expect(hero.said).not.toHaveBeenCalled()
    placeAt(1000)
    expect(hero.frame.isConnected).toBe(false)
    expect(displays()[0]?.classList.contains('is-ready')).toBe(false)
    expect(next.said).toHaveBeenLastCalledWith({ orden: 'demo', play: true }, location.origin)
    expect(live(2).frame.getAttribute('src')).toBe(`${location.origin}/?demo=markdown&loop`)
    expect(document.querySelectorAll('iframe.demo')).toHaveLength(2)
  })
  test('pauses what plays while the page is hidden', () => {
    vi.stubGlobal('matchMedia', media([]))
    showHome(window, '/')
    placeAt(0)
    vi.advanceTimersByTime(1000)
    const hero = live(0)
    sayReady(hero.inside)
    vi.spyOn(Document.prototype, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(hero.said).toHaveBeenLastCalledWith({ orden: 'demo', play: false }, location.origin)
  })
  test('holds every demo still when motion is reduced, and never tells it to play', () => {
    vi.stubGlobal('matchMedia', media(['(prefers-reduced-motion: reduce)']))
    showHome(window, '/')
    placeAt(0)
    vi.advanceTimersByTime(1000)
    const hero = live(0)
    const next = live(1)
    sayReady(hero.inside)
    sayReady(next.inside)
    placeAt(300)
    for (const { said } of [hero, next]) {
      expect(said).toHaveBeenCalledTimes(1)
      expect(said).toHaveBeenCalledWith({ orden: 'demo', still: true }, location.origin)
    }
  })
  test('finds the app beside itself when built under a path', () => {
    vi.stubGlobal('matchMedia', media([]))
    showHome(window, '/preview/')
    placeAt(0)
    vi.advanceTimersByTime(1000)
    expect(live(0).frame.getAttribute('src')).toBe(`${location.origin}/preview/app/?demo=flow&loop`)
  })
  test('shows the hero workflow first and then one display per feature, each under its own line', () => {
    expect(displays().map((one) => one.dataset.scene)).toEqual([...DEMO_LOOP_SCENES])
    expect(document.querySelector('.hero .display')?.getAttribute('data-scene')).toBe('flow')
    const features = [...document.querySelectorAll<HTMLElement>('.feature')]
    expect(features).toHaveLength(DEMO_LOOP_SCENES.length - 1)
    for (const feature of features) {
      expect(feature.querySelector('h2.line')?.textContent.trim()).toBeTruthy()
      expect(feature.querySelectorAll('.display')).toHaveLength(1)
    }
  })
  test('keeps its words few', () => {
    const words = document.body.textContent
      .replace(/Download|Try it out/g, '')
      .split(/\s+/)
      .filter(Boolean)
    expect(words.length).toBeLessThan(45)
  })
})
