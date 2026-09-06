import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'

/** Abbreviation → replacement. Loaded from the user's `snippets.json`, and
 *  read at completion time so an edit takes effect without a restart. */
let table: Record<string, string> = {}

export function setSnippets(next: Record<string, string>) {
  table = next
}

export function snippets(): Record<string, string> {
  return table
}

/** The first line, trimmed, for the completion list's second column. */
function summarise(body: string): string {
  const first = (body.split('\n')[0] ?? '').trim()
  return first.length > 48 ? `${first.slice(0, 47)}…` : first
}

export function snippetCompletions(context: CompletionContext): CompletionResult | null {
  const entries = Object.entries(table)
  if (!entries.length) return null

  const typed = context.matchBefore(/[\w-]{2,}/)
  if (!typed || (typed.from === typed.to && !context.explicit)) return null

  const query = typed.text.toLowerCase()
  const matches = entries.filter(([trigger]) => trigger.toLowerCase().startsWith(query))
  if (!matches.length) return null

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
