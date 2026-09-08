import { describe, expect, test } from 'vitest'
import { inkMode, wantedInkMode } from './backing'

/** The decision has no canvas in it, so a platform is a string and what the
 *  browser says about a context is an object. Both are written down. */

const DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/** The tablet this went wrong on: an Android WebView, which is the app's own. */
const TABLET =
  'Mozilla/5.0 (Linux; Android 14; SM-X710 Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.122 Safari/537.36'

/** Android Chrome, which is the same compositor without the app around it. */
const PHONE =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'

/** What Chromium answers: the attributes that were asked for, echoed back. */
const ECHOED: CanvasRenderingContext2DSettings = {
  alpha: true,
  desynchronized: true,
  willReadFrequently: false,
}

describe('which backing a layer of ink gets', () => {
  test('the hint is worth asking for before a context exists', () => {
    expect(inkMode({ agent: DESKTOP, reported: null })).toBe('latency')
  })

  test('and is kept where the browser says it was taken with alpha', () => {
    expect(inkMode({ agent: DESKTOP, reported: ECHOED })).toBe('latency')
  })

  test('an opaque backing is believed, whatever it costs in latency', () => {
    expect(inkMode({ agent: DESKTOP, reported: { ...ECHOED, alpha: false } })).toBe('plain')
  })

  test('a refused hint is a plain layer, there being no latency left to keep', () => {
    expect(inkMode({ agent: DESKTOP, reported: { ...ECHOED, desynchronized: false } })).toBe(
      'plain',
    )
  })

  test('an engine that says nothing about the hint is left alone', () => {
    expect(inkMode({ agent: DESKTOP, reported: { alpha: true } })).toBe('latency')
  })

  test('Android never gets the hint, whatever it reports', () => {
    for (const agent of [TABLET, PHONE]) {
      expect(inkMode({ agent, reported: null })).toBe('plain')
      expect(inkMode({ agent, reported: ECHOED })).toBe('plain')
    }
  })

  test('the fallback is stable, so replacing the element settles it', () => {
    const plain: CanvasRenderingContext2DSettings = { alpha: true, desynchronized: false }
    for (const agent of [DESKTOP, TABLET]) {
      expect(inkMode({ agent, reported: plain })).toBe('plain')
    }
  })

  test('no platform at all draws the ordinary way and still draws', () => {
    expect(inkMode({ agent: '', reported: null })).toBe('latency')
    expect(wantedInkMode()).toBe('latency')
  })
})
