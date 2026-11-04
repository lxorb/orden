/** A report's log with the reader's files taken out of it: what Send feedback says it sends
 *  (feedback.svelte.ts) is the app's log and never their notes, and a log line says where
 *  a note is - `save: /home/anna/Notes/Divorce lawyer.md - disk full` - which is the name
 *  of the person and of the note.
 *
 *  What stays is what a log is read for: the time, the level, what went wrong, the kind of
 *  file. A path becomes `<path 1>.md`, the same number each time it comes up in one report,
 *  so a note that failed three times still reads as one note. A web address stays, and a
 *  stack's own frames: those are the app's files. Rather too much taken than too little:
 *  nothing in a line says where a name with spaces in it starts, so a stretch before a
 *  note's extension goes back to the line's last colon or quote. Pure. */

/** The kinds of file a path that ends in one is taken to end at. */
const FILES =
  'md|markdown|txt|canvas|pdf|url|png|jpe?g|gif|webp|svg|mp3|m4a|wav|webm|mp4|mov|csv|json|html?|epub|docx?|xlsx?|pptx?|zip|excalidraw'

/** Not in the middle of a word, an address or a longer path. */
const NOT_INSIDE = String.raw`(?<![\w/\\:.~-])`

/** Where an absolute path starts: Unix, a home, a Windows drive, a share, a file address. */
const ROOT = String.raw`(?:file:/{2,3}|[A-Za-z]:[\\/]|\\\\|~[\\/]|/)`

/** An absolute path up to a file's extension, spaces and all. */
const WHOLE = new RegExp(
  String.raw`${NOT_INSIDE}${ROOT}[^\n"'\x60<>|]*?\.(${FILES})\b(?![\w-])`,
  'gi',
)

/** One with no such extension, a folder most often: up to the first thing that ends it. */
const OPEN = new RegExp(
  String.raw`${NOT_INSIDE}${ROOT}[^\s"'\x60<>|:;,()]+(?: (?!-|not\b|is\b|was\b|could\b|has\b|are\b|and\b|to\b|from\b|into\b|for\b|failed\b|cannot\b|does\b|did\b|already\b|because\b|of\b|in\b|on\b|at\b|with\b|after\b|before\b|but\b|so\b|as\b)[^\s"'\x60<>|:;,()/\\]+)*`,
  'g',
)

/** A path relative to its space, or a bare name, up to a file's extension: from the start
 *  of the message, a colon, a quote, a bracket or a word that comes before a name. */
const NAMED = new RegExp(
  String.raw`(?:(?<=(?:^|\s)(?:INFO|WARN|ERROR|info|warn|error) +)|(?<=: )|(?<=["'\x60(\[])|(?<= (?:of|to|from|into|at|in|for|as) ))(?=\S)[^\n"'\x60<>|:()\[\]]*?\.(${FILES})\b(?![\w-])`,
  'gm',
)

/** A word with a slash in it that is left: a folder relative to its space. Not an address,
 *  which has a colon NOT_INSIDE refuses, nor a kind of file such as `text/plain`. */
const FOLDER = /(?<![\w/\\:.~<-])(?!(?:text|image|audio|video|application)\/)[^\s"'`<>|:;,()]*[\\/][^\s"'`<>|:;,()]+/g

/** A stack's frame or a line of the app's own source, which is no reader's. */
const THE_APPS = /\.(?:ts|js|mjs|svelte|rs|tsx|jsx)$/i

/** A note that has no file yet is logged by its name, which is its first line; versions
 *  before this one wrote those on the way to a log that is still there. */
const UNFILED = /\b(save|across): (?!<path)(.+?)(?= - | took the whole words)/g

/** What stays of `log` for a report. */
export function scrubbedLog(log: string): string {
  const seen = new Map<string, number>()
  const path = (whole: string, kind?: string) => {
    const number = seen.get(whole) ?? seen.size + 1
    seen.set(whole, number)
    return kind ? `<path ${number}>.${kind}` : `<path ${number}>`
  }
  const kept = (whole: string, kind?: string) => (THE_APPS.test(whole) ? whole : path(whole, kind))

  return log
    .replace(WHOLE, (whole: string, kind: string) => path(whole, kind))
    .replace(OPEN, (whole: string) => kept(whole))
    .replace(NAMED, (whole: string, kind: string) => path(whole.trim(), kind))
    .replace(FOLDER, (whole: string) => kept(whole))
    .replace(UNFILED, (_: string, what: string) => `${what}: <a draft>`)
}
