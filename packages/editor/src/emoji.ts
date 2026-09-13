import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { emojiTable, loadEmoji } from '@nib/markdown/engines'

/** `:smile:` → 😄, or null when the name is not one - and null while the table is
 *  still on its way, which reads the same: the shortcode stays as the characters it
 *  was written with. The live preview draws it again when the table lands; see
 *  live-preview/decorate.ts and @nib/markdown/engines. */
export function emojiFor(shortcode: string): string | null {
  const table = emojiTable()
  if (!table) {
    void loadEmoji()
    return null
  }

  return table.get(shortcode) ?? null
}

/** Suggests emoji while typing `:na…`, the way Typora does.
 *
 *  The first `:` of a session is what fetches the table - a quarter of a megabyte of
 *  names, which nothing before this moment needed. Async, which is what a completion
 *  source is allowed to be, so the popup opens with the names in it rather than
 *  empty. */
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
