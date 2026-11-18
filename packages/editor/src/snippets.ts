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

const MARKED = /[^\s\p{L}\p{N}_-]+[\p{L}\p{N}_-]*/u
const WORD = /[\p{L}\p{N}_-]+/u

function triggered(
  context: CompletionContext,
  entries: readonly [string, string][],
): { from: number; matches: [string, string][] } | null {
  for (const pattern of [MARKED, WORD]) {
    const typed = context.matchBefore(pattern)
    if (!typed || typed.text.length < 2) continue

    const query = typed.text.toLowerCase()
    const offered = context.explicit
      ? (trigger: string) => trigger.startsWith(query)
      : (trigger: string) => trigger === query
    const matches = entries.filter(([trigger]) => offered(trigger.toLowerCase()))
    if (matches.length) return { from: typed.from, matches }
  }
  return null
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
