import { describe, expect, test } from 'vitest'
import {
  dayOf,
  embedFor,
  languageName,
  meetingName,
  meetingNote,
  piece,
  recordingNoteName,
  spanOf,
  summaryBlock,
  transcriptCallout,
  transcriptHeading,
  writtenBy,
} from './transcript'

describe('the embed a recording writes', () => {
  test('names the file, as Obsidian spells an embed', () => {
    expect(embedFor('recording-2026-09-12-1432.weba')).toBe('![[recording-2026-09-12-1432.weba]]')
  })
})

describe('a length', () => {
  test('reads the way a player writes one', () => {
    expect(spanOf(0)).toBe('0:00')
    expect(spanOf(9)).toBe('0:09')
    expect(spanOf(70)).toBe('1:10')
    expect(spanOf(600)).toBe('10:00')
    expect(spanOf(3609)).toBe('1:00:09')
    expect(spanOf(3600 * 2 + 61)).toBe('2:01:01')
  })

  test('and never reads as a negative one', () => {
    expect(spanOf(-5)).toBe('0:00')
  })
})

describe('a date', () => {
  test('is the day, padded, in the reader own clock', () => {
    expect(dayOf(new Date(2026, 8, 12, 23, 59))).toBe('2026-09-12')
    expect(dayOf(new Date(2026, 0, 3, 0, 1))).toBe('2026-01-03')
  })
})

describe('what a recording note is called', () => {
  /** The same shape for both, so the note and the file beside it read as one thing in
   *  the file list. */
  test('is the word, the day and the minute', () => {
    const at = new Date(2026, 8, 12, 14, 32)

    expect(meetingName(at)).toBe('Meeting 2026-09-12 1432')
    expect(recordingNoteName(at)).toBe('Recording 2026-09-12 1432')
  })
})

describe('the line that says a machine wrote something', () => {
  /** One line, italic, naming the model rather than "AI". The reader came for the
   *  words and not for a disclaimer. */
  test('names the model', () => {
    expect(writtenBy('whisper')).toBe('*Written by whisper*')
  })
})

describe('a transcript under an embed', () => {
  const said = transcriptCallout('Guten Morgen.\n\nWir fangen an.', 'German', 'whisper')

  /** A callout: one block, with a line saying whose words are in it, and nothing of
   *  the reader's own writing left sitting in a paragraph beside a machine's. */
  test('is one callout, headed with the language', () => {
    expect(said.split('\n')[0]).toBe('> [!quote] Transcript (German)')
    expect(said.split('\n')[1]).toBe('> *Written by whisper*')
  })

  /** Every line carries the mark, blank ones included, or the callout ends where the
   *  reader's own writing begins. */
  test('and carries the quote mark down every line', () => {
    for (const line of said.split('\n')) expect(line.startsWith('>')).toBe(true)
    expect(said).toContain('>\n> Wir fangen an.')
  })

  test('with no language named where the model did not say', () => {
    expect(transcriptCallout('Morning.', '', 'whisper')).toContain('> [!quote] Transcript\n')
  })
})

describe('a meeting note', () => {
  const at = new Date(2026, 8, 12, 14, 32)
  const note = meetingNote(meetingName(at), at, 'whisper')

  test('opens with the date in its front matter', () => {
    expect(note.startsWith('---\ndate: 2026-09-12\n---\n')).toBe(true)
  })

  /** The duration cannot be there from the first second; it is written into the same
   *  block when the recording stops. */
  test('and not with a duration, which is not known yet', () => {
    expect(note).not.toContain('duration')
  })

  test('is headed with its own name and ends at the transcript', () => {
    expect(note).toContain('# Meeting 2026-09-12 1432')
    expect(note.trimEnd().endsWith('*Written by whisper*')).toBe(true)
  })

  /** Everything written later is placed by finding this line, so the heading the note
   *  is made with and the one that is looked for have to be the same string. */
  test('carries the transcript heading the recorder looks for', () => {
    expect(note).toContain(`${transcriptHeading()}\n`)
    expect(transcriptHeading()).toBe('## Transcript')
    expect(transcriptHeading('German')).toBe('## Transcript (German)')
  })
})

describe('a piece of a live transcript', () => {
  test('is its own paragraph', () => {
    expect(piece('  and then we agreed.  ')).toBe('and then we agreed.\n\n')
  })

  test('and nothing at all where nothing was heard', () => {
    expect(piece('   ')).toBe('')
  })

  /** Nothing on this path knows who was talking, so whatever the model wrote is
   *  passed through: a model that labels its speakers keeps them, one that does not is
   *  plain, and a speaker is never invented here. */
  test('keeps a speaker label the model wrote itself', () => {
    expect(piece('A: yes.\nB: no.')).toBe('A: yes.\nB: no.\n\n')
  })
})

describe('a summary', () => {
  test('goes under the line that says a model wrote it', () => {
    expect(summaryBlock('## Takeaways\n\n- Decided\n', 'gpt-6-astra')).toBe(
      '*Written by gpt-6-astra*\n\n## Takeaways\n\n- Decided\n\n',
    )
  })

  test('and is nothing at all where the model wrote nothing', () => {
    expect(summaryBlock('  ', 'gpt-6-astra')).toBe('')
  })
})

describe('a language', () => {
  /** The platform's own list, which is the only one already translated into the four
   *  languages the app speaks. */
  test('is named rather than left as a tag', () => {
    expect(languageName('de', 'en')).toBe('German')
    expect(languageName('de', 'de')).toBe('Deutsch')
  })

  test('and is its own word where it is not a tag at all', () => {
    expect(languageName('', 'en')).toBe('')
    expect(languageName('klingon', 'en')).toBe('klingon')
  })
})
