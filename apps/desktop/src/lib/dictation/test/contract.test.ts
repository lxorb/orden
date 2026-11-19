import { describe, expect, test } from 'vitest'
import * as api from '../src/api'
import { promptOf } from '../src/heard'
import { recordingName } from '../src/recorder/container'
import { embedFor, recordingNoteName } from '../src/recorder/transcript'
import { RATE, wavOf } from '../src/recorder/wav'

describe('the module stands on its own', () => {
  test('the api loads with the recorder, its pill and the transcriber closed, and every call is there', () => {
    for (const one of [
      api.appendTo,
      api.canDictate,
      api.dictating,
      api.loadRecordingPill,
      api.recordRows,
      api.recordVoice,
      api.transcriber,
      api.transcribeRows,
    ]) {
      expect(typeof one).toBe('function')
    }
    expect(api.voice.of({ field: () => undefined })).toBe('idle')
  })
})
describe('what a recording is called and how it is shown', () => {
  test('the file is named by its day and minute, and the note by the same', () => {
    const at = new Date(2026, 8, 12, 14, 32)
    expect(recordingName(at, 'weba')).toBe('recording-2026-09-12-1432.weba')
    expect(recordingNoteName(at)).toBe('Recording 2026-09-12 1432')
  })
  test('the recording is embedded where it was made', () => {
    expect(embedFor('recording-2026-09-12-1432.weba')).toBe('![[recording-2026-09-12-1432.weba]]')
  })
})
describe('what dictation sends to be heard', () => {
  test('the words it should know come first, each once, before what was written last', () => {
    expect(promptOf('Earlier words', ['Orden', 'Orden', ' Zürich '])).toBe('Orden, Zürich. Earlier words')
    expect(promptOf('', [])).toBe('')
  })
  test('the sound goes out as 16 kHz mono wave', () => {
    const wav = wavOf(new Float32Array(RATE), RATE)
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF')
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(RATE)
  })
})
