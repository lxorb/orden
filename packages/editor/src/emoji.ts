import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { emojiTable, loadEmoji } from '@orden/markdown/engines'
import { inCode } from './code'

export function emojiFor(shortcode: string): string | null {
  const table = emojiTable()
  if (!table) {
    void loadEmoji()
    return null
  }
  return table.get(shortcode) ?? null
}
const WORDY = /[\p{L}\p{N}_]/u
export async function emojiCompletions(context: CompletionContext): Promise<CompletionResult | null> {
  const typed = context.matchBefore(/:[a-z0-9_+-]{2,}/i)
  if (!typed || (typed.from === typed.to && !context.explicit)) return null
  if (WORDY.test(context.state.sliceDoc(typed.from - 1, typed.from))) return null
  if (inCode(context.state, typed.from)) return null
  await loadEmoji()
  const table = emojiTable()
  if (!table) return null
  const query = typed.text.slice(1).toLowerCase()
  const found = table.search(query).slice(0, 24)
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
