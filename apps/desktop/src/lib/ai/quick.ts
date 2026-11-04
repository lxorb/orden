/** Where a quick question's answer goes into a note, and what its chip says went along.
 *  Pure; the store and the sheet are quick.svelte.ts and QuickQuestion.svelte. What a
 *  question is sent with is the panel's chat's own (#1115). */

/** Where a question's context came from, which is what the chip draws. */
export type ContextKind = 'selection' | 'note' | 'page'

/** Where an answer goes into a note, and what goes in: on lines of its own after the
 *  line `at` is on - under the selection it was asked about, or the caret's line -
 *  with a blank line either side of it, however much space was already there. */
export function insertion(
  doc: string,
  at: number,
  answer: string,
): { from: number; insert: string; caret: number } {
  const end = doc.indexOf('\n', Math.min(Math.max(at, 0), doc.length))
  const from = end === -1 ? doc.length : end
  const words = answer.trim()

  const before = doc.slice(0, from)
  const after = doc.slice(from)
  const lead = before.trim() ? '\n'.repeat(2 - breaks(/\n*$/, before)) : ''
  const trail = after.trim() ? '\n'.repeat(2 - breaks(/^\n*/, after)) : ''

  const insert = `${lead}${words}${trail}`
  return { from, insert, caret: from + lead.length + words.length }
}

/** How many line breaks, up to two, the run `at` finds at one end of a text holds. */
function breaks(at: RegExp, text: string): number {
  return Math.min(2, at.exec(text)?.[0].length ?? 0)
}
