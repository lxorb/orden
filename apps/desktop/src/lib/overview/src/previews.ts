import { portOf, type ScreenPreview } from '@orden/contracts'
import type { Tab } from '../../workspace.svelte'

export function readingFrom(doc: string, anchor: number | undefined, most: number): string {
  const at = Math.max(0, Math.min(anchor ?? 0, doc.length))
  const from = at === 0 ? 0 : doc.lastIndexOf('\n', at - 1) + 1
  return doc.slice(from, from + most)
}

export async function scrollbackOf(tab: Tab): Promise<ScreenPreview | null> {
  const port = portOf('terminal.previews')
  if (!port.ok) return null
  const home = (tab.note as { home?: string | null }).home ?? null
  return port.value.scrollback({ id: tab.id, doc: tab.doc, home }).catch(() => null)
}
