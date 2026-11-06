import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import { TAG_NAME } from '@orden/markdown/tags'
import { enclosingNamed } from './nodes'
import { fuzzy, noteIndex, type SpaceTag } from './wikilink/notes'

const MOST_SHOWN = 40

const NAME = TAG_NAME

const TYPED = new RegExp(String.raw`(?:^|[\s(])#(${NAME})?$`, 'u')

const VALUE = new RegExp(String.raw`(?:^|[\s,[])(${NAME})?$`, 'u')

const TAIL = new RegExp(String.raw`(${NAME})?$`, 'u')

const STILL_A_NAME = new RegExp(String.raw`^${NAME}$`, 'u')

const NOT_PROSE = new Set([
  'InlineCode',
  'CodeText',
  'CodeMark',
  'CodeInfo',
  'FencedCode',
  'CodeBlock',
  'InlineMath',
  'BlockMath',
  'HTMLTag',
  'HTMLBlock',
  'Comment',
  'CommentBlock',
  'PercentComment',
  'FrontMatter',
  'URL',
  'Autolink',
  'LinkTitle',
])

const KEY = /^tags?:/i

const ITEM = /^\s*-\s/

function inFrontMatterTags(context: CompletionContext): boolean {
  const at = syntaxTree(context.state).resolveInner(context.pos, -1)
  if (!enclosingNamed(at, 'FrontMatter')) return false

  const here = context.state.doc.lineAt(context.pos)
  if (KEY.test(here.text)) return true

  for (let number = here.number; number >= 1; number--) {
    const line = context.state.doc.line(number)
    if (number !== here.number && KEY.test(line.text)) return true
    if (!ITEM.test(line.text)) return false
  }

  return false
}

function rowsFor(tags: readonly SpaceTag[], needle: string): Completion[] {
  const rows: Completion[] = []

  for (const { tag, notes } of tags) {
    if (!fuzzy(tag, needle)) continue

    rows.push({ label: tag, detail: String(notes), type: 'keyword' })
    if (rows.length >= MOST_SHOWN) break
  }

  return rows
}

export function tagCompletions(context: CompletionContext): CompletionResult | null {
  const tags = context.state.facet(noteIndex).tags ?? []
  if (!tags.length) return null

  const front = inFrontMatterTags(context)
  const typed = context.matchBefore(front ? VALUE : TYPED)
  if (!typed) return null

  if (
    !front &&
    enclosingNamed(syntaxTree(context.state).resolveInner(context.pos, -1), NOT_PROSE)
  ) {
    return null
  }

  const name = TAIL.exec(typed.text)?.[1] ?? ''
  const from = context.pos - name.length

  const line = context.state.doc.lineAt(context.pos)
  if (!front && !name && line.text.slice(0, from - 1 - line.from).trim() === '') return null

  const rows = rowsFor(tags, name.toLowerCase())
  return rows.length ? { from, options: rows, validFor: STILL_A_NAME } : null
}
