/** What a window of the tab overview is drawn from when its tab is not in front, for the
 *  kinds that are drawn from what they hold rather than from a picture (issue #331; which
 *  kind is drawn how is its `preview` in workspace/tab-kinds.ts).
 *
 *  Emil, 2026-11-04: a preview is not a screenshot wherever it need not be. A note is its
 *  words as they are now, drawn by the reading renderer from where it was left, so it
 *  is sharp at any zoom and never stale; a terminal is the last of its screen as it was
 *  written down. Pure but for `scrollbackOf`, which asks the crate. */

import { peekHistory } from '../terminal/history'
import { readSpec } from '../terminal/spec'

/** A note's words from the start of the line it was left at, `most` of them at most: what
 *  its window reads as. `anchor` is the offset of the line at the top (Tab.anchor). */
export function readingFrom(doc: string, anchor: number | undefined, most: number): string {
  const at = Math.max(0, Math.min(anchor ?? 0, doc.length))
  const from = at === 0 ? 0 : doc.lastIndexOf('\n', at - 1) + 1
  return doc.slice(from, from + most)
}

/** Escapes a terminal writes: colours, the cursor, titles. */
// eslint-disable-next-line no-control-regex -- the terminal's own control characters are what is taken out
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|\r/g

/** The last `rows` lines of a screen as xterm.js wrote it down, as plain text. */
export function screenText(serialized: string, rows: number): string {
  const lines = serialized.replace(ESCAPES, '').split('\n')
  while (lines.length && !lines[lines.length - 1]?.trim()) lines.pop()
  return lines.slice(-Math.max(rows, 1)).join('\n')
}

/** The last of a terminal tab's screen, as written down, or null where there is none. */
export async function scrollbackOf(tab: {
  doc: string
  note: object
}): Promise<{ text: string; cols: number } | null> {
  const home = (tab.note as { home?: string | null }).home ?? null
  const key = readSpec(tab.doc)?.key ?? ''
  const history = await peekHistory({ space: home, key })
  return history ? { text: screenText(history.text, history.rows), cols: history.cols } : null
}
