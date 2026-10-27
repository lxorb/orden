/** A `#tag`, as a note writes one and a page draws one.
 *
 *  Obsidian's grammar, so a file means the same in either app: a hash opening a
 *  word, then a letter, mark, digit or emoji, then those and `-`, `_` and `/` - the
 *  slash nests `#work/nib` under `work`. A name of only digits is no tag, so `#42` is
 *  not one, nor a heading's `# `, and
 *  the opened word rules out `C#` and an address's `#fragment`. The editor's parser,
 *  the renderer below and the `#` popup read it here; the index's twins are the
 *  app's search/tags.ts and the crate's tags.rs. */

import type {
  MarkedExtension,
  Token,
  TokenizerAndRendererExtension,
  TokenizerExtension,
  Tokens,
} from 'marked'
import { attributeUrl, escapeAll } from './html'

// Code spans: a tag is never read in one. Here, not in escapes.ts, for the first paint.

/** What a backslash escapes, which is ASCII punctuation and nothing else: `\*`
 *  is a star, and `\U` is a backslash and a U. */
export const PUNCTUATION = /[!-/:-@[-`{-~]/

/** The text cut into what is code and what is not, in order, the way CommonMark
 *  cuts it: a run of backticks opens a code span that the next run of the same
 *  length closes, and one with no such run after it is backticks. A backtick with an
 *  escape in front of it - an odd run of backslashes - is the character and opens
 *  nothing, outside code; inside code a backslash is a backslash and escapes
 *  nothing, so `` `C:\\` `` closes on its second backtick. */
export function codeAndWords(text: string): { code: boolean; text: string }[] {
  const out: { code: boolean; text: string }[] = []
  let words = ''
  let at = 0
  while (at < text.length) {
    const char = text.charAt(at)
    if (char === '\\' && PUNCTUATION.test(text.charAt(at + 1))) {
      words += text.slice(at, at + 2)
      at += 2
      continue
    }
    if (char !== '`') {
      words += char
      at += 1
      continue
    }

    const run = /^`+/.exec(text.slice(at))?.[0] ?? '`'
    const close = closingRun(text, at + run.length, run.length)
    if (close === -1) {
      words += run
      at += run.length
      continue
    }
    if (words) out.push({ code: false, text: words })
    words = ''
    out.push({ code: true, text: text.slice(at, close + run.length) })
    at = close + run.length
  }
  if (words) out.push({ code: false, text: words })
  return out
}

/** Where the code spans in `text` start and end, so nothing inside one is read as
 *  a field or a tag: code is shown as it is written. */
export function codeSpans(text: string): [number, number][] {
  const out: [number, number][] = []
  let at = 0
  for (const one of codeAndWords(text)) {
    if (one.code) out.push([at, at + one.text.length])
    at += one.text.length
  }
  return out
}

/** Whether `at` falls inside one of the code spans `codeSpans` answered. */
export function inCode(code: [number, number][], at: number): boolean {
  return code.some(([from, to]) => at >= from && at < to)
}

/** Where the run of exactly `length` backticks closing a code span starts, from
 *  `from` on, or -1. */
function closingRun(text: string, from: number, length: number): number {
  for (let at = text.indexOf('`', from); at !== -1;) {
    const run = /^`+/.exec(text.slice(at))?.[0].length ?? 1
    if (run === length) return at
    at = text.indexOf('`', at + run)
  }
  return -1
}

const NAME_CHARS = String.raw`\p{L}\p{M}\p{N}\p{Extended_Pictographic}`

export const TAG_NAME = String.raw`(?!\p{N}+(?![${NAME_CHARS}\-_/]))[${NAME_CHARS}][${NAME_CHARS}\-_/]*`

/** Read where the hash is, so a paragraph is never copied to look at one word. */
const NAME_AT = new RegExp(TAG_NAME, 'uy')

const HASH = '#'

/** What emphasis, strike and highlight are written with. */
const MARKS = '*_~='

/** A whole name, to check one cut short by `tagAt`. */
const NAME = new RegExp(`^${TAG_NAME}$`, 'u')

/** Whether a hash at `at` opens a tag: one rule for the renderer, the editor and the
 *  index (search/tags.ts, tags.rs).
 *
 *  It opens a word: after nothing, a blank or a `(`, though not the `](` of a link,
 *  where `#heading` is where the link goes. A run of marks in between is the start of
 *  emphasis, strike or highlight, which the page reads afresh, so `**#tag**` is one;
 *  but marks in the middle of a word open nothing, so `a=#b` and `?q=#x` are words.
 *  A `|` opens one in a table row, a line that starts with one. */
export function opensTagAt(text: string, at: number): boolean {
  let start = at
  while (start > 0 && MARKS.includes(text.charAt(start - 1))) start--

  const before = text.charAt(start - 1)
  if (before === '' || /\s/u.test(before)) return true
  if (before === '(') return text.charAt(start - 2) !== ']'
  if (before === '|') return rowAt(text, start - 1)
  return false
}

/** Whether a hash after `before` opens a tag; see `opensTagAt`. */
export function opensTag(before: string): boolean {
  return opensTagAt(before, before.length)
}

/** Whether the line holding `at` starts, past its indent, with a `|`. */
function rowAt(text: string, at: number): boolean {
  let start = at
  while (start > 0 && text.charAt(start - 1) !== '\n') start--
  return text
    .slice(start, at + 1)
    .trimStart()
    .startsWith('|')
}

/** The name of the tag whose hash is at `at`, or null. Whether the hash opens a
 *  tag is the caller's to ask, through `opensTag`, or `tagAt` asks both. */
export function tagNameAt(text: string, at: number): string | null {
  if (text.charAt(at) !== HASH) return null

  NAME_AT.lastIndex = at + 1
  return NAME_AT.exec(text)?.[0] ?? null
}

/** The tag whose hash is at `at`, or null where none opens there. */
export function tagAt(text: string, at: number): string | null {
  if (!opensTagAt(text, at)) return null
  return closedBy(tagNameAt(text, at), underscoresBefore(text, at))
}

/** The tag `src` opens with, after the words `before`, or null. */
function tagAfter(before: string, src: string): string | null {
  if (!opensTag(before)) return null
  return closedBy(tagNameAt(src, 0), underscoresBefore(before, before.length))
}

/** How many `_` stand right in front of `at`. */
function underscoresBefore(text: string, at: number): number {
  let count = 0
  while (text.charAt(at - count - 1) === '_') count++
  return count
}

/** A name opened by `_` emphasis ends where the emphasis does: `_#urgent_` is the
 *  tag `urgent`, as the page draws it, and `__#todo__` is `todo`. */
function closedBy(name: string | null, underscores: number): string | null {
  if (name === null || underscores === 0) return name

  const close = '_'.repeat(underscores)
  if (!name.endsWith(close)) return name

  const cut = name.slice(0, -underscores)
  return NAME.test(cut) ? cut : null
}

/** Where marked should stop a run of text for a tag. Marked hands this the text
 *  from its second character, so a hash at 0 is offered and the tokenizer asks the
 *  token before it. */
function nextTag(src: string): number | undefined {
  for (let at = src.indexOf(HASH); at !== -1; at = src.indexOf(HASH, at + 1)) {
    if (tagAt(src, at) !== null) return at
  }

  return undefined
}

/** Where a pressed tag goes on this page, or null to leave it as words. */
export type TagHref = (tag: string) => string | null

/** `#work/nib`, drawn as a tag: a link where the surface says where one goes, and
 *  a `<span>` elsewhere, since a page that cannot go anywhere should not look as if
 *  it could. `tag` is the class Obsidian's pages and their themes already use.
 *
 *  Never in a link's words. Where a tag opens is `opensTagAt`'s to say, the same
 *  rule the editor and the index read by. The token carries its words as `text`
 *  for readers that never heard of a tag - a Word document, the glasses. */
export function hashtags(href?: TagHref): MarkedExtension {
  /** What was left of each run the last time it asked. */
  const seen = new WeakMap<Token[], string>()

  return remembering({
    extensions: [
      {
        name: 'hashtag',
        level: 'inline',
        start: nextTag,
        tokenizer(src: string, tokens: Token[]) {
          const before = seen.get(tokens)
          seen.set(tokens, src)
          if (this.lexer.state.inLink || !src.startsWith(HASH)) return undefined

          // What is before, read from what was left the last time this run asked,
          // which is this tail and more. Reading it off the token before flattened
          // that token's text, which marked grows a piece at a time: once per break
          // in a paragraph, and quadratic (#546). At the start of a run, the raw
          // words of the token before, read from their end and never copied.
          const name =
            before !== undefined && before.length > src.length
              ? tagAt(before, before.length - src.length)
              : tagAfter(tokens.at(-1)?.raw ?? '', src)
          if (name === null) return undefined

          const raw = `${HASH}${name}`
          return { type: 'hashtag', raw, text: raw, name }
        },
        renderer(token: Tokens.Generic) {
          const name = String(token.name)
          const said = `data-tag="${escapeAll(name)}"`
          const shown = escapeAll(`${HASH}${name}`)
          const target = href?.(name) ?? null

          return target === null
            ? `<span class="tag" ${said}>${shown}</span>`
            : `<a class="tag" href="${attributeUrl(target)}" ${said}>${shown}</a>`
        },
      },
    ],
  })
}

/** Inline extensions whose `start` reads each run of text once, not once per
 *  break in it.
 *
 *  Marked asks every inline `start` again at each break in a run of text, with
 *  all that is left of the run, so one that reads what it is given read the run
 *  once per break: a paragraph of `!a ` took seconds (#546). There is no blank
 *  line to stop at here, as `paragraphWindow` has for a block.
 *
 *  But what is left only ever shrinks from the front, and the answer carries over.
 *  If the first place was `at` for some tail, it is the first place for every
 *  shorter tail that still holds it; and none for one tail is none for all of
 *  them. So the answer is kept as a distance from the end, by the run's token
 *  list, and read again only once the run has passed it.
 *
 *  Which run a `start` is asked about is told by the tokenizer beside it: marked
 *  asks every inline tokenizer, with the tail and the run's token list, before it
 *  asks any `start` with that tail less its first character.
 *
 *  Here, beside the one inline extension the app loads before it first draws,
 *  rather than in starts.ts, which it does not load until later. */
export function remembering(extension: MarkedExtension): MarkedExtension {
  return { ...extension, extensions: extension.extensions?.map(remembered) ?? null }
}

function remembered(extension: TokenizerAndRendererExtension): TokenizerAndRendererExtension {
  if (!('tokenizer' in extension) || extension.level !== 'inline') return extension
  const { start, tokenizer } = extension
  if (!start) return extension

  const answers = new WeakMap<object, number>()
  let tokens: object | null = null
  let length = -1

  const remembering: Pick<TokenizerExtension, 'start' | 'tokenizer'> = {
    tokenizer(src, list) {
      tokens = list
      length = src.length
      return tokenizer.call(this, src, list)
    },
    start(src) {
      if (tokens === null || src.length !== length - 1) return start.call(this, src)

      const known = answers.get(tokens)
      if (known === -1) return undefined
      if (known !== undefined && src.length >= known) return src.length - known

      const at = start.call(this, src)
      const found = typeof at === 'number' && at >= 0
      answers.set(tokens, found ? src.length - at : -1)
      return found ? at : undefined
    },
  }
  return { ...extension, ...remembering }
}
