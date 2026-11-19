import { afterEach, describe, expect, test, vi } from 'vitest'
import { bestContainer, extensionOf, recordingName } from './container'

function supporting(types: string[]) {
  vi.stubGlobal('MediaRecorder', { isTypeSupported: (type: string) => types.includes(type) })
}
afterEach(() => {
  vi.unstubAllGlobals()
})
describe('which container to record into', () => {
  test.each([
    [['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'], 'audio/webm;codecs=opus'],
    [['audio/webm'], 'audio/webm'],
    [['audio/mp4;codecs=mp4a.40.2', 'audio/mp4'], 'audio/mp4;codecs=mp4a.40.2'],
    [[], ''],
  ])('among %j is %j: Opus in WebM, plain WebM, AAC in MP4, or the default', (types, best) => {
    supporting(types)
    expect(bestContainer()).toBe(best)
  })
  test('and nothing at all where there is no recorder', () => {
    expect(bestContainer()).toBeNull()
  })
})
describe('what a recording is called', () => {
  test.each([
    ['audio/webm;codecs=opus', 'weba'],
    ['audio/webm', 'weba'],
    ['audio/mp4;codecs=mp4a.40.2', 'm4a'],
    ['audio/ogg;codecs=opus', 'oga'],
    ['', 'weba'],
    ['audio/flurble', 'weba'],
  ])('says sound rather than film for %j, falling back to sound: %s', (type, extension) => {
    expect(extensionOf(type)).toBe(extension)
  })
  test('with every field padded, so a folder sorts', () => {
    const at = new Date(2026, 0, 3, 9, 5)
    expect(recordingName(at, 'm4a')).toBe('recording-2026-01-03-0905.m4a')
  })
})
