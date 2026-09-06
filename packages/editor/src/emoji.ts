import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'
import { get, search } from 'node-emoji'
import { snippetCompletions } from './snippets'

/** `:smile:` → 😄, or null when the name is not one. */
export function emojiFor(shortcode: string): string | null {
  return get(shortcode) ?? null
}

/** Suggests emoji while typing `:na…`, the way Typora does. */
function completions(context: CompletionContext): CompletionResult | null {
  const typed = context.matchBefore(/:[a-z0-9_+-]{2,}/i)
  if (!typed || (typed.from === typed.to && !context.explicit)) return null

  const query = typed.text.slice(1).toLowerCase()
  const found = search(query).slice(0, 24)
  if (!found.length) return null

  return {
    from: typed.from,
    options: found.map((entry) => ({
      label: `:${entry.name}:`,
      detail: entry.emoji,
      apply: entry.emoji,
      type: 'text',
    })),
  }
}

/** Emoji shortcodes and user snippets share one popup. */
export function editorCompletion(): Extension {
  return autocompletion({ override: [completions, snippetCompletions], icons: false })
}
