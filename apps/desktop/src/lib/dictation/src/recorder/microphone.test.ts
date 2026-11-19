import { afterEach, describe, expect, test, vi } from 'vitest'
import { MOST_BYTES, record } from './microphone'

const QUARTER = MOST_BYTES / 4
class FakeRecorder {
  static isTypeSupported = () => true
  static last: FakeRecorder | null = null
  state = 'recording'
  mimeType = 'audio/webm'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor() {
    FakeRecorder.last = this
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.onstop?.()
  }
  hand(size: number) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(size)]) })
  }
}
const tracks = { stopped: 0 }
afterEach(() => {
  vi.unstubAllGlobals()
  tracks.stopped = 0
})
function stubbed() {
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop: () => (tracks.stopped += 1) }] }),
    },
  })
}
describe('a recording that grows past what one may hold', () => {
  test('says so once, keeps what fit and lets go of the microphone when stopped', async () => {
    stubbed()
    const full = vi.fn()
    const held = await record({ full })
    const recorder = FakeRecorder.last
    if (!recorder) throw new Error('no recorder was made')
    recorder.hand(QUARTER)
    recorder.hand(QUARTER)
    recorder.hand(QUARTER)
    recorder.hand(QUARTER + 1)
    recorder.hand(1)
    recorder.hand(QUARTER)
    expect(full).toHaveBeenCalledTimes(1)
    const kept = await held.stop()
    expect(kept.bytes.byteLength).toBe(3 * QUARTER)
    expect(tracks.stopped).toBe(1)
  })
})
