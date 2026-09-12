/** What a recording, a transcript and a summary look like as markdown.
 *
 *  All of it pure, and all of it in one file, because the shapes have to agree:
 *  the embed a recording writes at the caret, the transcript a Transcribe row puts
 *  under that embed, the note a meeting starts with, and the summary that lands
 *  above the transcript when the meeting stops. Four writes, one voice.
 *
 *  Two decisions worth defending:
 *
 *  1. **A transcript under an embed is a callout; a meeting's transcript is the
 *     note's own body.** They are different things. The first is an annotation in
 *     the middle of somebody's own prose, and a callout is one block with a line
 *     to say whose words are in it - Obsidian folds it, nib folds it, and nothing
 *     of the reader's own writing is now sitting in a paragraph beside a machine's.
 *     The second *is* what the note is for, so it is headings and paragraphs like
 *     any other note, and arrives a piece at a time while somebody is still
 *     talking.
 *  2. **Whatever a model wrote says so, in one quiet line.** The same line in both
 *     places, naming the model rather than "AI": `*Written by whisper*`. It is
 *     italic and it is one line, because the reader came for the words and not for
 *     a disclaimer. */

import { formatWikilink } from '@nib/markdown/links'
import { t } from '../i18n.svelte'

/** The embed for a recording: `![[recording-2026-09-12-1432.weba]]`.
 *
 *  Through the package's own writer rather than by joining brackets onto a name, so
 *  a name with a bracket in it cannot write markup that means something else. */
export function embedFor(name: string): string {
  return formatWikilink({ target: name, heading: null, block: null, alias: null, embed: true })
}

/** A language as something to read: `de` as German, in the reader's own language,
 *  where the platform knows the name and as the code itself where it does not.
 *
 *  `Intl.DisplayNames` is in all three engines and is the only list of language
 *  names that is already translated into the four the app speaks; a table here
 *  would be four more rows to write for every language Whisper can hear. */
export function languageName(code: string, locale: string): string {
  const tidy = code.trim().toLowerCase()
  if (!tidy) return ''

  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(tidy) ?? tidy
  } catch {
    // A code that is not a language tag at all, which is what a model answering
    // with a whole word rather than a code looks like: its own word will do.
    return tidy
  }
}

/** The one line that says a machine wrote what is under it. */
export function writtenBy(model: string): string {
  return `*${t('Written by {model}', { model })}*`
}

/** What a transcript is headed with: the word, and the language where one was
 *  heard. `Transcript (German)`, or just `Transcript` when the model did not say. */
function heading(language: string): string {
  return language ? t('Transcript ({language})', { language }) : t('Transcript')
}

/** Every line of a passage inside a callout, which is a quote and so carries `>`
 *  down its left. A blank line stays blank apart from the mark, or the callout ends
 *  where the reader's own writing begins. */
function quoted(text: string): string {
  return text
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n')
}

/** The transcript of one recording, as the callout that goes under its embed.
 *
 *  `[!quote]` rather than a type of nib's own: it is the type Obsidian ships, it
 *  says what the block is without a word of explanation, and a space that travels
 *  to another app keeps its shape. */
export function transcriptCallout(text: string, language: string, model: string): string {
  return [`> [!quote] ${heading(language)}`, `> ${writtenBy(model)}`, '>', quoted(text)].join('\n')
}

/** A length as `1:04:09` or `4:09`, which is how every player writes one. */
export function spanOf(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(whole / 60) % 60
  const hours = Math.floor(whole / 3600)
  const rest = String(whole % 60).padStart(2, '0')

  if (!hours) return `${minutes}:${rest}`
  return `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
}

/** A date as the front matter writes it: the day, in the reader's own clock.
 *  `2026-09-12`, which is what every other tool that reads a note's front matter
 *  expects and what sorts correctly as a string. */
export function dayOf(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return `${at.getFullYear()}-${month}-${day}`
}

/** The clock as a name is written: `1432`. */
function clockOf(at: Date): string {
  const hour = String(at.getHours()).padStart(2, '0')
  const minute = String(at.getMinutes()).padStart(2, '0')
  return `${hour}${minute}`
}

/** What a meeting is called: the word and the time it started, so two meetings on
 *  one afternoon are told apart in the file list without either being opened. */
export function meetingName(at: Date): string {
  return `${t('Meeting')} ${dayOf(at)} ${clockOf(at)}`
}

/** And what a note made only to hold a recording is called. The same shape, so the
 *  note and the file beside it read as one thing in the list. */
export function recordingNoteName(at: Date): string {
  return `${t('Recording')} ${dayOf(at)} ${clockOf(at)}`
}

/** The heading the transcript of a meeting stands under. Everything the recorder
 *  writes later is placed by finding this line, so it is written once here and
 *  looked for nowhere else. */
export function transcriptHeading(language = ''): string {
  return `## ${heading(language)}`
}

/** The note a meeting starts with.
 *
 *  The date is there from the first second; the duration cannot be, and is written
 *  into the same block when the recording stops. The transcript heading is last,
 *  because the pieces arrive under it while somebody is still talking and appending
 *  to the end of a note is the one write that cannot land in the middle of a
 *  sentence somebody is typing. */
export function meetingNote(name: string, at: Date, model: string): string {
  return [
    '---',
    `date: ${dayOf(at)}`,
    '---',
    '',
    `# ${name}`,
    '',
    transcriptHeading(),
    writtenBy(model),
    '',
    '',
  ].join('\n')
}

/** A piece of a live transcript, as it is appended: its own paragraph.
 *
 *  A paragraph per piece rather than one that grows, because a piece is about
 *  twenty seconds of speech and a paragraph of that size is what the words were
 *  anyway. Whatever the model wrote is passed through as it stands - a model that
 *  labels its speakers `A:` keeps them, one that does not is plain - because
 *  nothing on this path knows who was talking and inventing a speaker would be
 *  worse than not naming one. */
export function piece(text: string): string {
  const said = text.trim()
  return said ? `${said}\n\n` : ''
}

/** The summary, as it goes above the transcript: whatever the model wrote, under
 *  the one line that says it did.
 *
 *  The model is asked for the two headings and writes them itself; see
 *  services/sync/src/ask/summary.ts. Nothing is parsed out of what it answers - a
 *  summary rewritten by this side to fit a shape is a summary about the shape. */
export function summaryBlock(text: string, model: string): string {
  const said = text.trim()
  if (!said) return ''

  return `${writtenBy(model)}\n\n${said}\n\n`
}
