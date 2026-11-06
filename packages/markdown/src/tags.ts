import type {
  MarkedExtension,
  Token,
  TokenizerAndRendererExtension,
  TokenizerExtension,
  Tokens,
} from 'marked'
import { attributeUrl, escapeAll } from './html'

export const PUNCTUATION = /[!-/:-@[-`{-~]/

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

export function codeSpans(text: string): [number, number][] {
  const out: [number, number][] = []
  let at = 0
  for (const one of codeAndWords(text)) {
    if (one.code) out.push([at, at + one.text.length])
    at += one.text.length
  }
  return out
}

export function inCode(code: [number, number][], at: number): boolean {
  return code.some(([from, to]) => at >= from && at < to)
}

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

const NAME_AT = new RegExp(TAG_NAME, 'uy')

const HASH = '#'

const MARKS = '*_~='

const NAME = new RegExp(`^${TAG_NAME}$`, 'u')

export function opensTagAt(text: string, at: number): boolean {
  let start = at
  while (start > 0 && MARKS.includes(text.charAt(start - 1))) start--

  const before = text.charAt(start - 1)
  if (before === '' || /\s/u.test(before)) return true
  if (before === '(') return text.charAt(start - 2) !== ']'
  if (before === '|') return rowAt(text, start - 1)
  return false
}

export function opensTag(before: string): boolean {
  return opensTagAt(before, before.length)
}

function rowAt(text: string, at: number): boolean {
  let start = at
  while (start > 0 && text.charAt(start - 1) !== '\n') start--
  return text
    .slice(start, at + 1)
    .trimStart()
    .startsWith('|')
}

export function tagNameAt(text: string, at: number): string | null {
  if (text.charAt(at) !== HASH) return null

  NAME_AT.lastIndex = at + 1
  return NAME_AT.exec(text)?.[0] ?? null
}

export function isTagName(name: string): boolean {
  return name !== '' && !/\/\/|\/$/.test(name) && tagAt(`#${name}`, 0) === name
}

export function tagAt(text: string, at: number): string | null {
  if (!opensTagAt(text, at)) return null
  return closedBy(tagNameAt(text, at), underscoresBefore(text, at))
}

function tagAfter(before: string, src: string): string | null {
  if (!opensTag(before)) return null
  return closedBy(tagNameAt(src, 0), underscoresBefore(before, before.length))
}

function underscoresBefore(text: string, at: number): number {
  let count = 0
  while (text.charAt(at - count - 1) === '_') count++
  return count
}

function closedBy(name: string | null, underscores: number): string | null {
  if (name === null || underscores === 0) return name

  const close = '_'.repeat(underscores)
  if (!name.endsWith(close)) return name

  const cut = name.slice(0, -underscores)
  return NAME.test(cut) ? cut : null
}

function nextTag(src: string): number | undefined {
  for (let at = src.indexOf(HASH); at !== -1; at = src.indexOf(HASH, at + 1)) {
    if (tagAt(src, at) !== null) return at
  }

  return undefined
}

export type TagHref = (tag: string) => string | null

export function hashtags(href?: TagHref): MarkedExtension {
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
