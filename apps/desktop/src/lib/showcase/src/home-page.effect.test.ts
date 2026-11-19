import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import PAGE from '../../../../home.html?raw'
import { elapse } from '../../../../test/effects/settle'
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
function demo() {
  const frame = document.querySelector<HTMLIFrameElement>('iframe.demo')
  if (!frame?.contentWindow) throw new Error('no demo frame')
  return { frame, inside: frame.contentWindow }
}
function sayReady(source: Window | null) {
  window.dispatchEvent(
    new MessageEvent('message', { data: { orden: 'demo', ready: true }, origin: location.origin, source }),
  )
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
      expect(link.textContent).toBe('Download for Windows')
      expect(link.href).toBe('https://github.com/lxorb/orden/releases/latest')
    }
    expect(asked).not.toHaveBeenCalled()
    await elapse(1000)
    expect(asked.mock.calls[0]?.[0]).toBe('https://api.github.com/repos/lxorb/orden/releases/latest')
    for (const link of downloads) expect(link.href).toBe(file)
    const apps = [...document.querySelectorAll<HTMLAnchorElement>('a[data-app]')]
    expect(apps).toHaveLength(2)
    for (const link of apps) expect(link.getAttribute('href')).toBe('/')
  })
  test('keeps the release page when the release cannot be read', async () => {
    vi.stubGlobal('matchMedia', media([]))
    showHome(window)
    await elapse(1000)
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a[data-download]'))
      expect(link.href).toBe('https://github.com/lxorb/orden/releases/latest')
  })
  test('loads the demo only once the page has loaded and gone idle, as a phone on a phone', () => {
    vi.stubGlobal('matchMedia', media(['(max-width: 719.98px)']))
    showHome(window)
    const { frame } = demo()
    expect(frame.getAttribute('src')).toBe(null)
    vi.advanceTimersByTime(1000)
    expect(frame.getAttribute('src')).toBe('/?demo=phone')
    expect(frame.hasAttribute('inert')).toBe(true)
    expect(frame.tabIndex).toBe(-1)
  })
  test('cues the demo once it says it is ready, and only then', () => {
    vi.stubGlobal('matchMedia', media(['(prefers-reduced-motion: reduce)']))
    showHome(window)
    vi.advanceTimersByTime(1000)
    const { frame, inside } = demo()
    const sent = vi.spyOn(inside, 'postMessage').mockImplementation(() => undefined)
    window.dispatchEvent(new Event('scroll'))
    expect(sent).not.toHaveBeenCalled()
    sayReady(window)
    expect(sent).not.toHaveBeenCalled()
    sayReady(inside)
    expect(frame.closest('.device')?.classList.contains('is-ready')).toBe(true)
    expect(sent).toHaveBeenLastCalledWith({ orden: 'demo', scene: 'canvas', at: 0, still: true }, location.origin)
    window.dispatchEvent(new Event('scroll'))
    expect(sent).toHaveBeenCalledTimes(2)
  })
  test('marks the hero and every chapter for a reader to scroll to', () => {
    const scenes = [...document.querySelectorAll<HTMLElement>('[data-scene]')].map((one) => one.dataset.scene)
    expect(scenes).toEqual(['hero', 'canvas', 'write', 'browse', 'organize', 'overview'])
  })
  test('keeps its words few', () => {
    const words = document.body.textContent
      .replace(/Download|Try it out/g, '')
      .split(/\s+/)
      .filter(Boolean)
    expect(words.length).toBeLessThan(40)
  })
})
