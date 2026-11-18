import { describe, expect, test } from 'vitest'
import {
  embedFor,
  languageName,
  recordingNoteName,
  transcriptCallout,
  writtenBy,
} from './transcript'

describe('the embed a recording writes', () => {
  test('names the file, as Obsidian spells an embed', () => {
    expect(embedFor('recording-2026-09-12-1432.weba')).toBe('![[recording-2026-09-12-1432.weba]]')
  })
})

describe('what a recording note is called', () => {
  test('is the word, the day and the minute', () => {
    const at = new Date(2026, 8, 12, 14, 32)

    expect(recordingNoteName(at)).toBe('Recording 2026-09-12 1432')
  })
})

describe('the line that says a machine wrote something', () => {
  test('names the model', () => {
    expect(writtenBy('whisper')).toBe('*Written by whisper*')
  })
})

describe('a transcript under an embed', () => {
  const said = transcriptCallout('Guten Morgen.\n\nWir fangen an.', 'German', 'whisper')

  test('is one callout, headed with the language', () => {
    expect(said.split('\n')[0]).toBe('> [!quote] Transcript (German)')
    expect(said.split('\n')[1]).toBe('> *Written by whisper*')
  })

  test('and carries the quote mark down every line', () => {
    for (const line of said.split('\n')) expect(line.startsWith('>')).toBe(true)
    expect(said).toContain('>\n> Wir fangen an.')
  })

  test('with no language named where the model did not say', () => {
    expect(transcriptCallout('Morning.', '', 'whisper')).toContain('> [!quote] Transcript\n')
  })
})

describe('a language', () => {
  test('is named rather than left as a tag', () => {
    expect(languageName('de', 'en')).toBe('German')
    expect(languageName('de', 'de')).toBe('Deutsch')
  })

  test('and is its own word where it is not a tag at all', () => {
    expect(languageName('', 'en')).toBe('')
    expect(languageName('klingon', 'en')).toBe('klingon')
  })
})
