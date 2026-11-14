import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import * as api from '../src/api'
import { promptOf } from '../src/heard'
import { recordingName } from '../src/recorder/container'
import { embedFor, recordingNoteName, spanOf } from '../src/recorder/transcript'
import { RATE, wavOf } from '../src/recorder/wav'

const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')
const ROOT = join(HERE, '../../../../..')
const ENDINGS = ['', '.ts', '.svelte.ts', '.svelte', '/index.ts']

function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}

function pendingOf(): string[] {
  const json = JSON.parse(readFileSync(join(HERE, 'module.json'), 'utf8')) as { pending?: string[] }
  return json.pending ?? []
}

describe('the module stands on its own', () => {
  test('nothing under src reaches past a module api or a file still listed as pending', () => {
    const pending = pendingOf()
    const reaching = sources(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/(?:from |import\()'(\.[^']*)'/g)].flatMap(
        (found) => {
          const target = resolve(dirname(file), found[1] ?? '')
          if (target.startsWith(SRC)) return []
          if (/\/[a-z-]+\/src\/api$/.test(target)) return []
          const path = ENDINGS.map((one) => target + one).find((one) => existsSync(one))
          const named = path === undefined ? target : relative(ROOT, path)
          return pending.includes(named) ? [] : [`${relative(SRC, file)}: ${found[1]}`]
        },
      ),
    )
    expect(reaching).toEqual([])
  })

  test('the api loads with the recorder, its pill and the transcriber closed, and every call is there', () => {
    for (const one of [
      api.appendTo,
      api.canDictate,
      api.canRecord,
      api.dictating,
      api.loadRecordingPill,
      api.record,
      api.recordingAt,
      api.recordLabel,
      api.recordVoice,
      api.transcribeEmbed,
      api.transcriber,
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

  test('a length reads as minutes and seconds, with hours only past the hour', () => {
    expect(spanOf(65)).toBe('1:05')
    expect(spanOf(3725)).toBe('1:02:05')
    expect(spanOf(-3)).toBe('0:00')
  })

  test('the recording is embedded where it was made', () => {
    expect(embedFor('recording-2026-09-12-1432.weba')).toBe('![[recording-2026-09-12-1432.weba]]')
  })
})

describe('what dictation sends to be heard', () => {
  test('the words it should know come first, each once, before what was written last', () => {
    expect(promptOf('Earlier words', ['Orden', 'Orden', ' Zürich '])).toBe(
      'Orden, Zürich. Earlier words',
    )
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
