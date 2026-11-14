import { peekHistory } from '../../terminal/history'
import { readSpec } from '../../terminal/spec'
import type { Tab } from '../../workspace.svelte'

export function readingFrom(doc: string, anchor: number | undefined, most: number): string {
  const at = Math.max(0, Math.min(anchor ?? 0, doc.length))
  const from = at === 0 ? 0 : doc.lastIndexOf('\n', at - 1) + 1
  return doc.slice(from, from + most)
}

// eslint-disable-next-line no-control-regex -- the terminal's own control characters are what is taken out
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|\r/g

export function screenText(serialized: string, rows: number): string {
  const lines = serialized.replace(ESCAPES, '').split('\n')
  while (lines.length && !lines[lines.length - 1]?.trim()) lines.pop()
  return lines.slice(-Math.max(rows, 1)).join('\n')
}

export async function scrollbackOf(tab: Tab): Promise<{ text: string; cols: number } | null> {
  const live = __EVEN_PLUGIN__
    ? null
    : await import('../../terminal/sessions.svelte')
        .then((one) => one.screenOf(tab))
        .catch(() => null)
  if (live) return live
  const home = (tab.note as { home?: string | null }).home ?? null
  const key = readSpec(tab.doc)?.key ?? ''
  const history = await peekHistory({ space: home, key })
  return history ? { text: screenText(history.text, history.rows), cols: history.cols } : null
}
