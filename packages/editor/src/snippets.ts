import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import { inCode } from './code'
import { enclosingNamed } from './nodes'

let table: Record<string, string> = {}

export function setSnippets(next: Record<string, string>) {
  table = next
}

export function snippets(): Record<string, string> {
  return table
}

function summarise(body: string): string {
  const first = (body.split('\n')[0] ?? '').trim()
  return first.length > 48 ? `${first.slice(0, 47)}…` : first
}

const IN_WORD = /[\p{L}\p{N}\p{M}_-]/u
const LOOK_BACK = 250

function folded(text: string): string {
  return text.normalize('NFC').toLowerCase()
}

const UNSPACED =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u
const ASCII = /^[\x20-\x7e]*$/

function onBoundary(before: string, at: number): boolean {
  const low = before.charCodeAt(at - 1)
  const paired = low >= 0xdc00 && low <= 0xdfff && at > 1
  const previous = before.slice(paired ? at - 2 : at - 1, at)
  return !IN_WORD.test(previous) || UNSPACED.test(previous)
}

function typedLength(before: string, trigger: string, whole: boolean): number {
  const wanted = folded(trigger)
  const plain = ASCII.test(wanted)
  const most = Math.min(before.length, plain ? wanted.length : wanted.length * 4)
  const least = plain && whole ? wanted.length : 2
  for (let length = most; length >= least; length--) {
    const typed = folded(before.slice(before.length - length))
    if (typed.length < 2 || !onBoundary(before, before.length - length)) continue
    if (whole ? typed === wanted : wanted.startsWith(typed)) return length
  }
  return 0
}

function triggered(
  context: CompletionContext,
  entries: readonly [string, string][],
): { from: number; matches: [string, string][] } | null {
  const line = context.state.doc.lineAt(context.pos)
  const before = context.state.sliceDoc(Math.max(line.from, context.pos - LOOK_BACK), context.pos)
  const found = entries
    .map((entry) => ({ entry, length: typedLength(before, entry[0], !context.explicit) }))
    .filter((one) => one.length > 0)
  const longest = found.reduce((most, one) => Math.max(most, one.length), 0)
  if (!longest) return null

  return {
    from: context.pos - longest,
    matches: found.filter((one) => one.length === longest).map((one) => one.entry),
  }
}

export function snippetCompletions(context: CompletionContext): CompletionResult | null {
  const entries = Object.entries(table)
  if (!entries.length) return null

  const typed = triggered(context, entries)
  if (!typed || inCode(context.state, typed.from)) return null
  if (enclosingNamed(syntaxTree(context.state).resolveInner(typed.from, 1), 'FrontMatter'))
    return null

  const { matches } = typed

  return {
    from: typed.from,
    options: matches.map(([trigger, body]) => ({
      label: trigger,
      detail: summarise(body),
      apply: body,
      type: 'keyword',
    })),
  }
}
