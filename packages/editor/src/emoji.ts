import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { emojiTable, loadEmoji } from '@orden/markdown/engines'

export function emojiFor(shortcode: string): string | null {
  const table = emojiTable()
  if (!table) {
    void loadEmoji()
    return null
  }

  return table.get(shortcode) ?? null
}

export async function emojiCompletions(
  context: CompletionContext,
): Promise<CompletionResult | null> {
  const typed = context.matchBefore(/:[a-z0-9_+-]{2,}/i)
  if (!typed || (typed.from === typed.to && !context.explicit)) return null

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
