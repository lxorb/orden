import { afterEach, describe, expect, test, vi } from 'vitest'
import { edgesOf, startInsets, tintSystemBars, writeEdges } from './insets'

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
    expect(() => tintSystemBars(true)).not.toThrow()
  })

  test('reads them at start, and again whenever the activity says so', () => {
    const page = root()
    const bars: boolean[] = []
    let edges = '{"top":24,"right":0,"bottom":48,"left":0}'
    const window: Record<string, unknown> = {}

    vi.stubGlobal('__ORDEN_SYSTEM__', {
      insets: () => edges,
      bars: (dark: boolean) => void bars.push(dark),
    })
    vi.stubGlobal('window', window)
    vi.stubGlobal('document', { documentElement: page.element })

    startInsets()
    expect(page.written.get('--inset-top')).toBe('24px')

    edges = '{"top":0,"right":48,"bottom":0,"left":48}'
    const again = window.__ordenInsets
    expect(typeof again).toBe('function')
    ;(again as () => void)()
    expect(page.written.get('--inset-top')).toBe('0px')
    expect(page.written.get('--inset-right')).toBe('48px')

    tintSystemBars(true)
    tintSystemBars(false)
    expect(bars).toEqual([true, false])
  })
})

test.each<[unknown, ...Parameters<typeof edgesOf>]>([
  [null, 'undefined'],
  [null, ''],
  [null, '{"top":24,"right":0,"bottom":48}'],
  [null, '{"top":"24px","right":0,"bottom":48,"left":0}'],
  [null, '{"top":-8,"right":0,"bottom":0,"left":0}'],
  [null, '[24,0,48,0]'],
  [null, 'null'],
])('%j from %j', (expected, ...args) => {
  expect(edgesOf(...args)).toBe(expected)
})
