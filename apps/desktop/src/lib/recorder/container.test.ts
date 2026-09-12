import { afterEach, describe, expect, test, vi } from 'vitest'
import { bestContainer, extensionOf, recordingName } from './container'

/** A `MediaRecorder` that admits to exactly the types named. There is no recorder in
 *  node at all, so this is also what says what a build with none answers. */
function supporting(types: string[]) {
  vi.stubGlobal('MediaRecorder', { isTypeSupported: (type: string) => types.includes(type) })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('which container to record into', () => {
  /** Opus in a WebM is the best sound per byte anything ships, and the codec is named
   *  because a bare `audio/webm` means Vorbis on some builds. */
  test('is Opus in a WebM wherever that is offered', () => {
    supporting(['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'])
    expect(bestContainer()).toBe('audio/webm;codecs=opus')
  })

  test('and the plain type where the parameter is refused', () => {
    supporting(['audio/webm'])
    expect(bestContainer()).toBe('audio/webm')
  })

  /** WKWebView has never had Opus. AAC in an MP4 is what it writes, and asking for it
   *  by name is what stops a video container being used for sound. */
  test('is AAC in an MP4 on WebKit', () => {
    supporting(['audio/mp4;codecs=mp4a.40.2', 'audio/mp4'])
    expect(bestContainer()).toBe('audio/mp4;codecs=mp4a.40.2')
  })

  /** The empty string is a real answer and the important one: a recorder made with no
   *  type writes the platform's own default, and what it chose is read back off it. */
  test('is the platform default where it will name none of them', () => {
    supporting([])
    expect(bestContainer()).toBe('')
  })

  test('and nothing at all where there is no recorder', () => {
    expect(bestContainer()).toBeNull()
  })
})

describe('what a recording is called', () => {
  /** `![[take.webm]]` is a film to nib and to Obsidian both, and a film embed draws a
   *  black rectangle over sound with no picture. `.weba` is the spelling that says
   *  sound; see packages/markdown/src/links.ts. */
  test('says sound rather than film, whatever the codec was', () => {
    expect(extensionOf('audio/webm;codecs=opus')).toBe('weba')
    expect(extensionOf('audio/webm')).toBe('weba')
    expect(extensionOf('audio/mp4;codecs=mp4a.40.2')).toBe('m4a')
    expect(extensionOf('audio/ogg;codecs=opus')).toBe('oga')
  })

  test('and falls back to sound for a type nothing here knows', () => {
    expect(extensionOf('')).toBe('weba')
    expect(extensionOf('audio/flurble')).toBe('weba')
  })

  /** The date and the time to the minute, in the reader's own clock: a hash of the
   *  bytes would be a name nobody can find again, and two recordings are never the
   *  same bytes anyway. */
  test('is the minute it was made in', () => {
    const at = new Date(2026, 8, 12, 14, 32, 9)
    expect(recordingName(at, 'weba')).toBe('recording-2026-09-12-1432.weba')
  })

  test('with every field padded, so a folder sorts', () => {
    const at = new Date(2026, 0, 3, 9, 5)
    expect(recordingName(at, 'm4a')).toBe('recording-2026-01-03-0905.m4a')
  })
})
