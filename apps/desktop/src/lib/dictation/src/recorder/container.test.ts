import { afterEach, describe, expect, test, vi } from 'vitest'
import { bestContainer, extensionOf, recordingName } from './container'

function supporting(types: string[]) {
  vi.stubGlobal('MediaRecorder', { isTypeSupported: (type: string) => types.includes(type) })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('which container to record into', () => {
  test('is Opus in a WebM wherever that is offered', () => {
    supporting(['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'])
    expect(bestContainer()).toBe('audio/webm;codecs=opus')
  })

  test('and the plain type where the parameter is refused', () => {
    supporting(['audio/webm'])
    expect(bestContainer()).toBe('audio/webm')
  })

  test('is AAC in an MP4 on WebKit', () => {
    supporting(['audio/mp4;codecs=mp4a.40.2', 'audio/mp4'])
    expect(bestContainer()).toBe('audio/mp4;codecs=mp4a.40.2')
  })

  test('is the platform default where it will name none of them', () => {
    supporting([])
    expect(bestContainer()).toBe('')
  })

  test('and nothing at all where there is no recorder', () => {
    expect(bestContainer()).toBeNull()
  })
})

describe('what a recording is called', () => {
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

  test('is the minute it was made in', () => {
    const at = new Date(2026, 8, 12, 14, 32, 9)
    expect(recordingName(at, 'weba')).toBe('recording-2026-09-12-1432.weba')
  })

  test('with every field padded, so a folder sorts', () => {
    const at = new Date(2026, 0, 3, 9, 5)
    expect(recordingName(at, 'm4a')).toBe('recording-2026-01-03-0905.m4a')
  })
})
