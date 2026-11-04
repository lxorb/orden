/** A report's log with the reader's files and addresses taken out of it. A log line says
 *  where a note is - `save: /home/anna/Notes/Divorce lawyer.md - disk full` - which is the
 *  name of the person and of the note, and what Send feedback says it sends is the log with
 *  file paths removed (FeedbackSheet.svelte).
 *
 *  What stays is what a log is read for: the time, the level, what went wrong, the kind of
 *  file. A path becomes `<path 1>.md`, the same number each time it comes up in one report,
 *  so a note that failed three times still reads as one note. An address keeps its origin
 *  and the service's own routes; a stack's frames are the app's files and stay. Words an
 *  error quotes go, which is how a note's words reach a log: `"Dear lawyer"... is not valid
 *  JSON`. Nothing can tell a name with no extension and no slash from the words round it,
 *  which is why the sheet promises paths and not more. Pure. */

/** The kinds of file a path that ends in one is taken to end at. */
const FILES =
  'md|markdown|txt|canvas|pages|base|pdf|url|png|jpe?g|gif|webp|svg|mp3|m4a|wav|webm|mp4|mov|csv|json|html?|epub|docx?|xlsx?|pptx?|zip|excalidraw'

/** Not in the middle of a word, an address or a longer path. */
const NOT_INSIDE = String.raw`(?<![\w/\\:.~<-])`

/** The service's own routes, which name no file of anybody's. */
const ROUTE = String.raw`(?!/(?:v\d+|api)/)`

/** Where an absolute path starts: Unix, a home, a Windows drive, a share, a file address. */
const ROOT = String.raw`(?:file:/{2,3}|[A-Za-z]:[\\/]|\\\\|~[\\/]|${ROUTE}/)`

/** The words that end a name with no extension, where a line goes on about it. */
const ENDS = String.raw`(?:-|\d+\b|not\b|is\b|was\b|were\b|could\b|has\b|had\b|are\b|and\b|to\b|from\b|into\b|for\b|failed\b|cannot\b|can't\b|does\b|did\b|already\b|because\b|of\b|in\b|on\b|at\b|with\b|after\b|before\b|but\b|so\b|as\b|took\b|unreadable\b)`

/** An absolute path up to a file's extension, spaces and all, inside one clause. */
const WHOLE = new RegExp(
  String.raw`${NOT_INSIDE}${ROOT}(?:(?! - )[^\n"'\x60<>|])*?\.(${FILES})\b(?![\w-])`,
  'gi',
)

/** A word of a name with no extension, past the first. */
const MORE = String.raw`(?: (?!${ENDS})[^\s"'\x60<>|:;,()]+)*`

/** One with no such extension, a folder most often: up to the first thing that ends it. */
const OPEN = new RegExp(String.raw`${NOT_INSIDE}${ROOT}[^\s"'\x60<>|:;,()]+${MORE}`, 'g')

/** A path relative to its space, or a bare name, up to a file's extension: from the start
 *  of the message, a colon, a quote, a bracket or a word that comes before a name. */
const NAMED = new RegExp(
  String.raw`(?:(?<=(?:^|\s)(?:INFO|WARN|ERROR|info|warn|error) +)|(?<=: )|(?<=[(\[])|(?<= (?:of|to|from|into|at|in|for|as) ))(?=\S)[^\n"'\x60<>|:()\[\]]*?\.(${FILES})\b(?![\w-])`,
  'gim',
)

/** What a line says before a name, which stays: not one of a name's first words, as those
 *  go lower case only where the line is talking. */
const SAYING =
  /^(?:(?:could|can't|cannot|not|failed|unable|to|parse|read|write|open|load|save|move|moved|delete|the|rename|of|a|file|note|from|in|into|at|for|as|sync|skipping)\s+)+/

/** A word with a slash in it that is left: a folder relative to its space, and the rest of
 *  its name. Not an address, which has a colon NOT_INSIDE refuses. */
const FOLDER = new RegExp(
  String.raw`${NOT_INSIDE}(?!(?:text|image|audio|video|application)/)[^\s"'\x60<>|:;,()]*[\\/][^\s"'\x60<>|:;,()]+${MORE}`,
  'g',
)

/** A slash in words, a date or a service's route, which is no folder. */
const NO_FOLDER = /^(?:and\/or|read\/write|input\/output|w\/o|[\d/.-]+|\/(?:v\d+|api)\/\S*)$/i

/** A stack's frame or a line of the app's own source, which is no reader's. */
const THE_APPS = /\.(?:ts|js|mjs|svelte|rs|tsx|jsx)$/i

/** The webview's way to a local file: a path by another name. */
const ASSET = /\b(?:asset:\/\/\S+|https?:\/\/asset\.localhost\/\S+)/gi

/** An address: who it says, where it is and what it carries after that. */
const ADDRESS = /\b(https?|wss?|ftp):\/\/(?:[^\s/@]+@)?([^\s/?#]+)([^\s?#]*)(?:[?#][^\s]*)?/gi

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g

/** Words an error quotes, of three characters or more or one in single quotes. */
const QUOTED = /"[^"\n]+"|(?<![\w])'[^'\n]+'(?![\w])|\x60[^\x60\n]+\x60/g

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
  const kept = (whole: string) => (THE_APPS.test(whole) ? whole : path(whole))

  return log
    .replace(ASSET, (whole: string) => path(whole))
    .replace(ADDRESS, (whole: string, scheme: string, host: string, route: string) => {
      if (THE_APPS.test(route.replace(/(?::\d+)+$/, ''))) return whole
      const own = /^\/v\d+\//.test(route)
      return `${scheme}://${host}${own ? route : route.length > 1 ? '/…' : ''}`
    })
    .replace(EMAIL, '<email>')
    .replace(QUOTED, '<quoted>')
    .replace(WHOLE, (whole: string, kind: string) => path(whole, kind))
    .replace(OPEN, (whole: string) => kept(whole))
    .replace(NAMED, (whole: string, kind: string) => {
      const said = SAYING.exec(whole)?.[0] ?? ''
      return said + path(whole.slice(said.length).trim(), kind)
    })
    .replace(FOLDER, (whole: string) => (NO_FOLDER.test(whole) ? whole : kept(whole)))
    .replace(UNFILED, (_: string, what: string) => `${what}: <a draft>`)
}
