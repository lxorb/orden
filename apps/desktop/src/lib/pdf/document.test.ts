import { describe, expect, test } from 'vitest'
import { current, decodesImages } from './document'

describe('which pdf.js this engine can run', () => {
  const modern = {
    Promise: { try: () => undefined },
    Uint8Array: { fromBase64: () => undefined },
    Math: { sumPrecise: () => 0 },
  }

  test('the current one, where every built-in it relies on is there', () => {
    expect(current(modern)).toBe(true)
  })

  test.each(['Promise', 'Uint8Array', 'Math'] as const)(
    'the legacy one, where %s is missing what it needs',
    (name) => {
      expect(current({ ...modern, [name]: {} })).toBe(false)
    },
  )
})

describe("whose image decoder a PDF's pictures go through", () => {
  const MAC =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'
  const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)'
  const EDGE =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'
  const ANDROID =
    'Mozilla/5.0 (Linux; Android 15; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36'

  test.each([MAC, LINUX])('pdf.js its own on WebKit: %s', (agent) => {
    expect(decodesImages(agent)).toBe(false)
  })

  test.each([EDGE, ANDROID])("the engine's on Chromium: %s", (agent) => {
    expect(decodesImages(agent)).toBe(true)
  })
})
