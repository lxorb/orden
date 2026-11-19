import { describe, expect, test } from 'vitest'
import {
  APP_HREF,
  cueOf,
  DEMO_PHONE_SRC,
  DEMO_SCENES,
  DEMO_SRC,
  downloadFor,
  frameOf,
  isDemoCue,
  isDemoReady,
  LATEST_RELEASE,
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
  test('offers the file for the system the visitor is on', () => {
    expect(downloadFor({ userAgent: MAC }, '0.21.1')).toEqual({
      label: 'Download for macOS',
      href: asset('macos-universal.dmg'),
    })
    expect(downloadFor({ userAgent: WINDOWS }, '0.21.1').href).toBe(asset('windows-x64-setup.exe'))
    expect(downloadFor({ userAgent: WINDOWS, architecture: 'arm' }, '0.21.1').href).toBe(
      asset('windows-arm64-setup.exe'),
    )
    expect(downloadFor({ userAgent: LINUX }, '0.21.1')).toEqual({
      label: 'Download for Linux',
      href: asset('linux-x64.AppImage'),
    })
    expect(downloadFor({ userAgent: LINUX_ARM }, '0.21.1').href).toBe(asset('linux-arm64.AppImage'))
    expect(downloadFor({ userAgent: ANDROID }, '0.21.1').href).toBe(asset('android.apk'))
  })
  test('sends anyone it has no file for to the latest release', () => {
    const latest = { label: 'Download', href: LATEST_RELEASE }
    expect(downloadFor({ userAgent: IPHONE }, '0.21.1')).toEqual(latest)
    expect(downloadFor({ userAgent: MAC, touchPoints: 5 }, '0.21.1')).toEqual(latest)
    expect(downloadFor({ userAgent: 'curl/8.0' }, '0.21.1')).toEqual(latest)
    expect(downloadFor({ userAgent: MAC }, 'under test')).toEqual(latest)
  })
  test('and Try it out opens the app', () => {
    expect(APP_HREF).toBe('/')
  })
})
