import type { PreviewedTab, ScreenPreview } from '@orden/contracts'
import { peekHistory } from './history'
import { readSpec } from './spec'

// eslint-disable-next-line no-control-regex -- the terminal's own control characters are what is taken out
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|\r/g

export function screenText(serialized: string, rows: number): string {
  const lines = serialized.replace(ESCAPES, '').split('\n')
  while (lines.length && !lines[lines.length - 1]?.trim()) lines.pop()
  return lines.slice(-Math.max(rows, 1)).join('\n')
}

export async function scrollbackOf(tab: PreviewedTab): Promise<ScreenPreview | null> {
  const live = __EVEN_PLUGIN__
    ? null
    : await import('./sessions.svelte').then((one) => one.screenOf(tab)).catch(() => null)
  if (live) return live
  const key = readSpec(tab.doc)?.key ?? ''
  const history = await peekHistory({ space: tab.home, key })
  return history ? { text: screenText(history.text, history.rows), cols: history.cols } : null
}
