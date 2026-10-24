/** A page's text, as markdown that says the same words.
 *
 *  Markdown's markers are ordinary punctuation, so a page's prose is full of
 *  characters a note would read as markup: the star in a glob, the underscore in
 *  a file name, the plus somebody typed to make a bullet. A backslash in front of
 *  each is what turndown writes, and what it buys is that the note shows what the
 *  page showed.
 *
 *  It bought it too widely, and it bought the wrong thing twice.
 *
 *  Too widely, because turndown escapes every marker it can see whatever sits
 *  around it, and most of those escapes change nothing a reader would ever see.
 *  `cx_out` is not emphasis to any reader of markdown - an underscore inside a
 *  word opens none - so `cx\_out` is a backslash the note carries for no reason,
 *  and the file is somebody's writing rather than a transport format. So: escape
 *  where the escape changes what is rendered, and nowhere else.
 *
 *  The wrong thing, because a page whose visible text *is* markdown - a course
 *  page quoting a lecturer's `**kurz**`, a forum post, anything that shows syntax
 *  outside a code block - was pasted into a markdown editor and arrived as
 *  `\*\*kurz\*\*`: the characters, faithfully, and never bold however hard
 *  anybody looked at them. Faithful is not what a person guesses there. And the
 *  converter was never consistent about it anyway: `~~struck~~` and
 *  `==highlighted==` have always come through as markup, because turndown has no
 *  rule for either, so `**` was the odd marker out rather than the principled
 *  one. So a run that is unmistakably markdown is kept as it was written.
 *
 *  Unmistakably is the whole of the judgement, and it is deliberately narrow,
 *  because the two mistakes are not the same size. An escape too many leaves a
 *  backslash in the note: visible, ugly, and a person can delete it. An escape
 *  too few eats the characters: silent, and found much later if at all. So a
 *  doubled marker around plain words (`**kurz**`, `__fett__`) and a code span
 *  (`` `npm run dev` ``) are kept, because nobody puts two stars on each side of
 *  a word by accident - and a single marker is not, because `rename *.md to
 *  *.txt` is a sentence rather than a phrase in italics.
 *
 *  Everything a conversion writes goes through here - a paste, a clip, an import
 *  - which is the same promise from-html.ts makes about the rest of its markers:
 *  a page pasted into a note and the same page clipped come out as one file. */

import { OPENS_MARKUP } from './words'

/** A `<` that would open a tag, escaped. Not `asWords`, which doubles the backslashes
 *  in front of one: here every backslash has been escaped already, by `escapeAt`. */
function bracketsOf(text: string): string {
  return text.replace(OPENS_MARKUP, '\\<')
}

/** What a backslash escapes, which is ASCII punctuation and nothing else: `\*`
 *  is a star, and `\U` is a backslash and a U. */
const PUNCTUATION = /[!-/:-@[-`{-~]/

/** A letter or a digit. What an underscore has to sit between for markdown to
 *  refuse to read it as emphasis: a delimiter inside a word is both-flanking and
 *  next to no punctuation, so it can neither open nor close. */
const WORD = /[\p{L}\p{N}]/u

const BLANK = /\s/

/** The characters that would open a block where the page had a paragraph, at the
 *  start of the text and nowhere else - which is where turndown looked for them
 *  too. A hyphen is a bullet with a blank after it and a rule with two more;
 *  `-5°C` is a temperature. */
const A_BLOCK = /^(?:-(?=[\s-]|$)|\+ |>|~~~|=+|#{1,6} )/

/** A number that would open an ordered list, with a dot or with CommonMark's other
 *  marker, a parenthesis. The escape goes on the marker; the digits are a number
 *  either way. */
const A_NUMBER = /^(\d+)([.)]) /

/** A code span: as many backticks as it closes with, and something between them.
 *  Whatever else is in there is inert - markdown reads a code span as the
 *  characters it is made of, which is the same reason a fence keeps a page's own
 *  brackets; see `preformatted` in from-html.ts.
 *
 *  Three at the most, which is every code span anybody writes and is also what
 *  keeps this linear: an open-ended run of backticks is a run the engine tries
 *  every length of, and a page is somebody else's to fill with as many of them as
 *  it likes. A longer one is escaped, as it was before. */
const A_CODE_SPAN = /(`{1,3})([^`]+)\1(?!`)/y

/** A doubled emphasis marker around plain words. The words may hold nothing the
 *  escaping was protecting the note from - no marker, no bracket, no backslash,
 *  no `<`, no `%` that could open a comment, no `$` that could open maths, no `=`
 *  that could open a highlight - so what a page gets to keep is a phrase in bold,
 *  and never markup of its own in somebody's note. */
const A_STRONG = /(\*\*|__)([^`*_[\]\\<%$=]+)\1/y

/** A bare web address, the way the renderer's autolink reads one: marked's GFM
 *  `url` rule, a scheme it links or `www.` and then everything up to a blank or a
 *  `<`. What it then trims off the end is `TRAILING`'s to say.
 *
 *  Kept as it was written because the renderer links the address character for
 *  character, backslashes included: `https://www.cs.cmu.edu/\~bob/` is drawn as a
 *  link to `/%5C~bob/`, a page that does not exist. And nothing inside one needs an
 *  escape, because once the autolink has the address nothing else reads it. */
const A_URL = /(?:(?:[hH][tT][tT][pP][sS]?|[fF][tT][pP]):\/\/|www\.)(?:[a-zA-Z0-9-]+\.?)+[^\s<]*/y

/** marked's `_backpedal`: the punctuation an address does not end in, so the full
 *  stop after one is the sentence's and a bracket is the one around it. Run until
 *  it changes nothing, as marked runs it. */
const TRAILING = /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/

/** The letters an address can start with, asked before the pattern is run: a
 *  conversion walks every character of a page and almost all of them are letters
 *  that start nothing. */
const AN_ADDRESS = /[hHfFw]/

/** The address that starts here, as the renderer would link it, or nothing. Not one
 *  holding two percent signs: those open a comment, which takes the address out of
 *  the page whatever is done to it, so it is escaped as the words it is. */
function addressAt(text: string, at: number): string | null {
  if (!AN_ADDRESS.test(text[at] ?? '')) return null
  A_URL.lastIndex = at
  let address = A_URL.exec(text)?.[0]
  if (!address) return null

  for (let before = ''; before !== address;) {
    before = address
    address = TRAILING.exec(address)?.[0] ?? ''
  }
  return address && !address.includes('%%') ? address : null
}

/** Whether a run markdown would read may stay as it was written: nothing blank
 *  against the markers, which is where markdown stops reading one, and no more of
 *  the same marker on either side of it - `***a***` is not this rule's to judge. */
function unmistakable(text: string, at: number, found: RegExpExecArray): boolean {
  const run = found[0]
  const marker = run[0]
  const inside = found[2] ?? ''

  if (text[at - 1] === marker || text[at + run.length] === marker) return false
  return !BLANK.test(inside[0] ?? ' ') && !BLANK.test(inside.at(-1) ?? ' ')
}

/** The three characters a kept run can start with, asked before either pattern
 *  is run against the text: a conversion walks every character of a page and
 *  almost all of them are letters. */
const A_RUN = /[`*_]/

/** The markdown that starts here and needs no escaping, or nothing. */
function keptAt(text: string, at: number): string | null {
  if (!A_RUN.test(text[at] ?? '')) return null

  for (const pattern of [A_CODE_SPAN, A_STRONG]) {
    pattern.lastIndex = at
    const found = pattern.exec(text)
    if (found && unmistakable(text, at, found)) return found[0]
  }

  return null
}

function isWord(one: string | undefined): boolean {
  return one !== undefined && WORD.test(one)
}

/** Blank, and the ends of the text are not: the node before this one ended in
 *  something and the node after it starts with something, and neither is this
 *  function's to guess at. Where a character's neighbours are unknown it is
 *  escaped, which is the answer that can only cost a backslash. */
function isBlank(one: string | undefined): boolean {
  return one !== undefined && BLANK.test(one)
}

/** One character, escaped where a reader would otherwise take it for markup.
 *
 *  `midLine` says whether anything has been written before it on this line, which
 *  is what a star needs to know: turndown hands over one text node at a time with
 *  its newlines already collapsed, so a character with words before it in the
 *  same node is a character that cannot begin a list. */
function escapeAt(text: string, at: number, midLine: boolean): string {
  const one = text[at] ?? ''
  const before = text[at - 1]
  const after = text[at + 1]

  switch (one) {
    // An escape of the punctuation after it, or a backslash. At the end of the
    // text it is in front of whatever the next node begins with.
    case '\\':
      return after === undefined || PUNCTUATION.test(after) ? '\\\\' : '\\'
    // Never emphasis inside a word, which is where a file name and a variable
    // keep theirs.
    case '_':
      return isWord(before) && isWord(after) ? '_' : '\\_'
    // A star with a blank on each side leans neither way, so it can neither open
    // emphasis nor close it, and `2 * 3` is arithmetic. At the start of a line it
    // is a bullet instead.
    case '*':
      return midLine && isBlank(before) && isBlank(after) ? '*' : '\\*'
    // Lowered and raised text, `H~2~O` and `x^2^`, open on a mark with something
    // other than a blank after it and close on the next one, so `~5 min or ~10`
    // would lower the words between. Two tildes are a line through. A mark with a
    // blank after it opens neither, and with every one that could escaped there is
    // nothing for it to close.
    case '~':
    case '^':
      return isBlank(after) ? one : `\\${one}`
    // Two percent signs open a comment and the next two close it, which takes the
    // words between out of the page: `printf("%%d")` quoted twice would lose a
    // sentence. One sign is a percentage and never anything else, so only the
    // second of a pair is escaped, and `%\%` reads as the two signs it says.
    case '%':
      return before === '%' ? '\\%' : '%'
    // Two equals signs open a highlight and the next two close it, so `a==b or
    // c==d` would mark the words between. The same answer as for `%`: the second
    // of a pair is escaped, and `=\=` reads as the two signs it says.
    case '=':
      return before === '=' ? '\\=' : '='
    // Inline maths opens on a dollar with something other than a blank after it
    // and closes on one with something other than a blank before it, so in
    // `$5-$10` the two prices would be a formula of `5-`. A dollar with a blank on
    // each side can do neither, and with every other one escaped there is nothing
    // for a later dollar to pair with.
    case '$':
      return isBlank(before) && isBlank(after) ? '$' : '\\$'
    case '`':
    case '[':
    case ']':
      return `\\${one}`
    default:
      return one
  }
}

/** A page's words, as a note may hold them.
 *
 *  `addresses` says whether a bare web address is kept as written, which is only
 *  right where the renderer will autolink it. Inside a link's brackets nothing
 *  does - marked and the editor both read a link's text as markdown - so there an
 *  address is words like any other, and `pkg/__init__.py` unescaped would be
 *  `init` in bold. Off unless asked for, because the caller that forgets is one
 *  writing a link's text of its own, a media link's name or a card's title, and an
 *  address escaped as words costs a backslash where one kept in brackets is markup. */
export function escapeText(
  text: string,
  { addresses = false }: { addresses?: boolean } = {},
): string {
  const out: string[] = []
  const numbered = A_NUMBER.exec(text)
  const block = numbered ? null : A_BLOCK.exec(text)

  // A block marker is only ever the first thing in the text, so it is answered
  // once rather than asked about at every character after it.
  let escaped = numbered ? `${numbered[1]}\\${numbered[2]} ` : block ? `\\${block[0]}` : ''
  let at = (numbered?.[0] ?? block?.[0] ?? '').length
  let midLine = at > 0

  while (at < text.length) {
    const address = addressAt(text, at)

    // In a link's text an address is words, every character of it escaped as words
    // are: not kept, and not a place a kept run may start either, which would make
    // the `__init__` of `pkg/__init__.py` bold.
    if (address && !addresses) {
      for (const end = at + address.length; at < end; at++) {
        escaped += escapeAt(text, at, midLine)
      }
      midLine = true
      continue
    }

    if (address) {
      // Written as it is but for its brackets and backticks. The same words can be a
      // link's text, where nothing autolinks and a bare `]` would close the brackets
      // around it - `[https://a.test/](https://evil.test)` - and a backtick would open
      // code that runs past them. Escaped, they are the characters a link's text shows,
      // and the renderer's autolink takes the escapes back off; see `bareAddress`
      // in index.ts. A `<` just before is asked about with the address after it.
      out.push(bracketsOf(escaped + address).slice(0, -address.length))
      out.push(address.replace(/[[\]`]/g, '\\$&'))
      escaped = ''
      at += address.length
      midLine = true
      continue
    }

    const kept = keptAt(text, at)

    if (kept) {
      // The words on either side of a kept run are escaped as the text they are,
      // and `bracketsOf` reads two characters at a time - so a run is a boundary for
      // it as well. Nothing it looks for spans one: a `<` before a kept run is
      // followed by a marker, and a marker opens no tag.
      out.push(bracketsOf(escaped), kept)
      escaped = ''
      at += kept.length
      midLine = true
      continue
    }

    escaped += escapeAt(text, at, midLine)
    midLine ||= !isBlank(text[at])
    at += 1
  }

  out.push(bracketsOf(escaped))
  return out.join('')
}

/** The marker a line of plain text opens a list item with: a bullet or a number,
 *  indented or not. Plain text typed in another app writes a list that way and
 *  every reader of it, markdown or not, sees one. */
const A_LIST_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/

/** Words typed in another app that never meant markdown - a Keep note, a Tomboy
 *  note's text, a spreadsheet's cell - as a note may hold them: written so they
 *  read back as the characters they are.
 *
 *  `escapeText` already knows what each character would do in a note, and the
 *  same escapes are wanted here: a tag opener, the dollars of `$5-$10`, the
 *  tildes of `~5 or ~10`, the second of two percent signs. It is asked a line
 *  at a time, because plain text keeps its line breaks and each line starts where
 *  a block could. A line that opens a list item keeps its marker, since that is a
 *  list in the app it came from as well; its words are escaped as words.
 *
 *  And it is asked past the line's indentation, which markdown reads through: up to
 *  three spaces in front, `   # x` is still a heading and `  > x` a quote. Four make
 *  the line code, where every escape would be shown as a backslash, so an indent that
 *  deep is written in no-break spaces, which hold the line where it was and open
 *  nothing. */
export function plainWords(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const marker = A_LIST_ITEM.exec(line)?.[0]
      if (marker) return marker + escapeText(line.slice(marker.length), { addresses: true })

      const indent = /^[ \t]*/.exec(line)?.[0] ?? ''
      const words = escapeText(line.slice(indent.length), { addresses: true })
      return (columnsOf(indent) < 4 ? indent : NO_BREAK.repeat(columnsOf(indent))) + words
    })
    .join('\n')
}

const NO_BREAK = '\u00a0'

/** How far in an indent reaches, a tab going on to the next stop of four, as
 *  markdown counts it. */
function columnsOf(indent: string): number {
  let columns = 0
  for (const one of indent) columns = one === '\t' ? columns + 4 - (columns % 4) : columns + 1
  return columns
}

/** A backslash escape: one in front of ASCII punctuation, which is all CommonMark
 *  lets one escape. */
const AN_ESCAPE = /\\([!-/:-@[-`{-~])/g

/** A code span, as CommonMark closes one: a run of backticks and the next run of
 *  the same length. What is inside is shown as written, backslashes and all. */
const A_CODE = /(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)/g

/** The text cut into what is code and what is not, in order. */
function codeAndWords(text: string): { code: boolean; text: string }[] {
  const out: { code: boolean; text: string }[] = []
  let at = 0
  for (const found of text.matchAll(A_CODE)) {
    if (found.index > at) out.push({ code: false, text: text.slice(at, found.index) })
    out.push({ code: true, text: found[0] })
    at = found.index + found[0].length
  }
  if (at < text.length) out.push({ code: false, text: text.slice(at) })
  return out
}

/** Words as a field or a notification shows them: every escape taken off, so a
 *  task written `milk \$3` reads `milk $3`. Not in code, which shows its
 *  backslashes as they are written. The inverse is `typedWords`. */
export function shownWords(text: string): string {
  return codeAndWords(text)
    .map((one) => (one.code ? one.text : one.text.replace(AN_ESCAPE, '$1')))
    .join('')
}

/** Where in `shownWords` of the text each character stands whose escape it took off:
 *  what the line said was a word and not markup, which a field that reads its words
 *  again must leave a word (`\#tips` is not a tag). */
export function unescapedAt(text: string): number[] {
  const out: number[] = []
  let at = 0
  for (const one of codeAndWords(text)) {
    if (one.code) {
      at += one.text.length
      continue
    }
    let taken = 0
    for (const found of one.text.matchAll(AN_ESCAPE)) {
      out.push(at + found.index - taken)
      taken++
    }
    at += one.text.length - taken
  }
  return out
}

/** Words typed into a field that edits a line of markdown, a task's title, written
 *  back with the escapes `shownWords` took off: whatever would open maths, lowered or
 *  raised text, a comment or a highlight, a tag, or would take the next character's
 *  escape for itself. What the writer typed as markup of their own - bold, a link,
 *  code - is left to be that, which is why this is narrower than `escapeText`. */
export function typedWords(text: string): string {
  return codeAndWords(text)
    .map((one) => {
      if (one.code) return one.text
      let out = ''
      const words = one.text
      for (let at = 0; at < words.length; at++) {
        const char = words.charAt(at)
        const before = words[at - 1]
        const after = words[at + 1]
        const escaped =
          (char === '\\' && after !== undefined && PUNCTUATION.test(after)) ||
          (char === '$' && !(isBlank(before) && isBlank(after))) ||
          ((char === '~' || char === '^') && !isBlank(after)) ||
          ((char === '%' || char === '=') && before === char) ||
          (char === '<' && /[A-Za-z/!?]/.test(after ?? ''))
        out += escaped ? `\\${char}` : char
      }
      return out
    })
    .join('')
}

/** Where an escaped character is held while a reader looks for markup, so `\*` is
 *  never the start of emphasis: the character, moved into the private use area. */
const HELD = 0xe000

/** The words with each escape held as one character no markup pattern matches;
 *  `released` gives each back. For a reader of inline markup that is not a
 *  markdown parser, the view's `pieces`, which would otherwise read `\*a\*` as
 *  emphasis and show the backslashes. */
export function heldEscapes(text: string): string {
  return text.replace(AN_ESCAPE, (_, one: string) => String.fromCharCode(HELD + one.charCodeAt(0)))
}

/** Held escapes given back: as the characters they escaped, or as written, with the
 *  backslash, for code, which shows them as they are. */
export function released(text: string, asWritten = false): string {
  return text.replace(/[-]/g, (one) => {
    const char = String.fromCharCode(one.charCodeAt(0) - HELD)
    return asWritten ? `\\${char}` : char
  })
}
