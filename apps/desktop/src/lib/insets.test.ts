import { afterEach, describe, expect, test, vi } from 'vitest'
import { edgesOf, startInsets, tintSystemBars, writeEdges } from './insets'

/** The window's own edges arriving from the activity. Everything that crosses
 *  is a string, so the only interesting question is which strings become four
 *  numbers and which are refused - a page that took a bad one would put its
 *  toolbar under the clock and never say why. */

/** The document root as the page writes insets to it. */
function root() {
  const written = new Map<string, string>()

  return {
    written,
    element: {
      style: { setProperty: (name: string, value: string) => written.set(name, value) },
    } as unknown as HTMLElement,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('what the activity hands over', () => {
  test('four numbers become four edges', () => {
    expect(edgesOf('{"top":24,"right":0,"bottom":48,"left":0}')).toEqual({
      top: 24,
      right: 0,
      bottom: 48,
      left: 0,
    })
  })

  test('anything that is not JSON is refused', () => {
    expect(edgesOf('undefined')).toBe(null)
    expect(edgesOf('')).toBe(null)
  })

  test('so is an edge missing, or one that is not a number', () => {
    expect(edgesOf('{"top":24,"right":0,"bottom":48}')).toBe(null)
    expect(edgesOf('{"top":"24px","right":0,"bottom":48,"left":0}')).toBe(null)
    expect(edgesOf('{"top":-8,"right":0,"bottom":0,"left":0}')).toBe(null)
  })

  test('and a shape that is not an object at all', () => {
    expect(edgesOf('[24,0,48,0]')).toBe(null)
    expect(edgesOf('null')).toBe(null)
  })
})

describe('what the page does with them', () => {
  test('writes each edge over the token the stylesheets read', () => {
    const page = root()
    writeEdges(page.element, { top: 24, right: 0, bottom: 48, left: 12 })

    expect(page.written.get('--inset-top')).toBe('24px')
    expect(page.written.get('--inset-bottom')).toBe('48px')
    expect(page.written.get('--inset-left')).toBe('12px')
    expect(page.written.get('--inset-right')).toBe('0px')
  })

  test('nothing at all where there is no activity to ask', () => {
    const page = root()
    vi.stubGlobal('document', { documentElement: page.element })
    vi.stubGlobal('window', {})

    startInsets()
    expect(page.written.size).toBe(0)
    // And the bars are left to whoever else draws them.
    expect(() => tintSystemBars(true)).not.toThrow()
  })

  test('reads them at start, and again whenever the activity says so', () => {
    const page = root()
    const bars: boolean[] = []
    let edges = '{"top":24,"right":0,"bottom":48,"left":0}'
    const window: Record<string, unknown> = {}

    vi.stubGlobal('__NIB_SYSTEM__', {
      insets: () => edges,
      bars: (dark: boolean) => void bars.push(dark),
    })
    vi.stubGlobal('window', window)
    vi.stubGlobal('document', { documentElement: page.element })

    startInsets()
    expect(page.written.get('--inset-top')).toBe('24px')

    // Turned on its side: the cutout moves to one edge and the activity nudges.
    edges = '{"top":0,"right":48,"bottom":0,"left":48}'
    const again = window.__nibInsets
    expect(typeof again).toBe('function')
    ;(again as () => void)()
    expect(page.written.get('--inset-top')).toBe('0px')
    expect(page.written.get('--inset-right')).toBe('48px')

    tintSystemBars(true)
    tintSystemBars(false)
    expect(bars).toEqual([true, false])
  })
})
