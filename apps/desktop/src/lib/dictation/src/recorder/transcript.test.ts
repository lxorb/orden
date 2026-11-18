import { describe, expect, test } from 'vitest'
import { languageName, transcriptCallout, writtenBy } from './transcript'

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
