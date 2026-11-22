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
  test('says how long ago the latest release came out once it is read, and nothing before', async () => {
    vi.stubGlobal('matchMedia', media([]))
    vi.setSystemTime(new Date('2026-11-24T09:00:00Z'))
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ published_at: '2026-11-21T11:12:54Z', assets: [] })))),
    )
    showHome(window, '/')
    const line = document.querySelector<HTMLElement>('[data-updated]')
    expect(line?.hidden).toBe(true)
    await elapse(1000)
    expect(line?.hidden).toBe(false)
    expect(line?.textContent.replace(/\s+/g, ' ').trim()).toBe('The last update was 2 days ago.')
  })
  test('says plainly that Orden is open source and free, and where its changes and wishes go', () => {
    expect(document.querySelector('.free')?.textContent).toContain('Open source and 100% free.')
    const links = [...document.querySelectorAll<HTMLAnchorElement>('.growing a')].map((one) => one.getAttribute('href'))
    expect(links).toEqual(['https://github.com/lxorb/orden/releases', 'https://github.com/lxorb/orden/issues/new'])
    const platforms = [...document.querySelectorAll('.platforms svg')].map((one) => one.getAttribute('aria-label'))
    expect(platforms).toEqual(['Windows', 'macOS', 'Linux', 'Android'])
  })
  test('ends on its two buttons alone, with a line to call for questions at the very bottom', () => {
    const coda = document.querySelector('.coda')
    expect(coda?.querySelectorAll('a.orden-button')).toHaveLength(2)
    expect(coda?.querySelector('.display, .line')).toBe(null)
    const contact = coda?.querySelector('.contact')
    expect(contact?.textContent.replace(/\s+/g, ' ').trim()).toBe('Questions? +49 177 1696470')
    expect(contact?.querySelector('a')?.getAttribute('href')).toBe('tel:+491771696470')
    expect(coda?.lastElementChild).toBe(contact)
  })
  test('keeps the release page when the release cannot be read', async () => {
    vi.stubGlobal('matchMedia', media([]))
    showHome(window)
    await elapse(1000)
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a[data-download]'))
      expect(link.href).toBe('https://github.com/lxorb/orden/releases/latest')
  })
  test('loads no demo until the page has gone idle, then one at a time, nearest first, as phones on a phone', () => {
    vi.stubGlobal('matchMedia', media(['(max-width: 719.98px)']))
    showHome(window, '/')
    placeAt(0)
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
    vi.advanceTimersByTime(1000)
    const sources = () =>
      [...document.querySelectorAll<HTMLIFrameElement>('iframe.demo')].map((one) => one.getAttribute('src'))
    expect(sources()).toEqual([`${location.origin}/?demo=flow&loop&phone`])
    sayReady(live(0).inside)
    expect(sources()).toEqual([
      `${location.origin}/?demo=flow&loop&phone`,
      `${location.origin}/?demo=canvas&loop&phone`,
    ])
    sayReady(live(1).inside)
    expect(sources()).toHaveLength(3)
    sayReady(live(2).inside)
    expect(sources()).toHaveLength(3)
    for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe.demo')) {
      expect(frame.hasAttribute('inert')).toBe(true)
      expect(frame.tabIndex).toBe(-1)
      expect(frame.getAttribute('aria-hidden')).toBe('true')
    }
  })
  test('starts the displays below before they are seen, pauses them off screen, keeps them warm and lets them go far away', () => {
    vi.stubGlobal('matchMedia', media([]))
    showHome(window, '/')
    placeAt(0)
    vi.advanceTimersByTime(1000)
    const hero = live(0)
    sayReady(hero.inside)
    const next = live(1)
    sayReady(next.inside, 'https://elsewhere.example')
    sayReady(window)
    expect(displays()[1]?.classList.contains('is-ready')).toBe(false)
    sayReady(next.inside)
    expect(displays()[1]?.classList.contains('is-ready')).toBe(true)
    expect(next.said).toHaveBeenLastCalledWith({ orden: 'demo', play: false }, location.origin)
    expect(hero.said).not.toHaveBeenCalled()
    sayReady(live(2).inside)
    placeAt(1000)
    expect(hero.frame.isConnected).toBe(true)
    expect(hero.said).toHaveBeenLastCalledWith({ orden: 'demo', play: false }, location.origin)
    expect(next.said).toHaveBeenLastCalledWith({ orden: 'demo', play: true }, location.origin)
    expect(live(3).frame.getAttribute('src')).toBe(`${location.origin}/?demo=pages&loop`)
    placeAt(6000)
    expect(hero.frame.isConnected).toBe(false)
    expect(displays()[0]?.classList.contains('is-ready')).toBe(false)
    expect(document.querySelectorAll('iframe.demo').length).toBeLessThanOrEqual(4)
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
  test('shows only the posters when motion is reduced, and loads no demo at all', () => {
    vi.stubGlobal('matchMedia', media(['(prefers-reduced-motion: reduce)']))
    showHome(window, '/')
    placeAt(0)
    vi.advanceTimersByTime(1000)
    placeAt(300)
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
  })
  test('shows a display marked poster-only as its poster alone, while the rest still load', () => {
    vi.stubGlobal('matchMedia', media([]))
    showHome(window, '/')
    const ai = displays().findIndex((one) => one.dataset.scene === 'ai')
    expect(displays()[ai]?.hasAttribute('data-poster-only')).toBe(true)
    displays().forEach((box, index) => {
      const top = (index - ai) * 1000
      vi.spyOn(box, 'getBoundingClientRect').mockReturnValue({ top, bottom: top + 600 } as DOMRect)
    })
    window.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(1000)
    expect(displays()[ai]?.querySelector('iframe')).toBe(null)
    const loaded = [...document.querySelectorAll<HTMLIFrameElement>('iframe.demo')]
    expect(loaded.length).toBe(1)
    expect(loaded[0]?.getAttribute('src')).not.toContain('demo=ai')
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
    expect(words.length).toBeLessThan(100)
  })
})
