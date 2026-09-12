import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'
import { get, search } from 'node-emoji'
import { slashCompletions } from './slash'
import { snippetCompletions } from './snippets'
import { tagCompletions } from './tags'
import { wikilinkCompletions } from './wikilink/complete'

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

/** The blocks a `/` offers, emoji shortcodes, user snippets, the notes a `[[`
 *  link can name and the tags a `#` opens all share one popup: each source
 *  answers for the characters that open it, so only one of them ever has anything
 *  to say.
 *
 *  The slash comes first because it is the only one whose opening character the
 *  others could also be sitting on: a `/` is not a word, and a source that has
 *  something to say about one has the first word. */
export function editorCompletion(): Extension {
  return autocompletion({
    override: [
      slashCompletions,
      completions,
      snippetCompletions,
      wikilinkCompletions,
      tagCompletions,
    ],
    icons: false,
  })
}
