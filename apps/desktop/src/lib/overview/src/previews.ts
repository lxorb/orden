import { portOf, type ScreenPreview } from '@orden/contracts'
import type { Tab } from '../../documents/src/api'

const LINE = 120
export function readingFrom(doc: string, anchor: number | undefined, lines: number): string {
  const at = Math.max(0, Math.min(anchor ?? 0, doc.length))
  const from = at === 0 ? 0 : doc.lastIndexOf('\n', at - 1) + 1
  let to = from - 1
  for (let line = 0; line < lines && (line === 0 || to >= 0); line++) to = doc.indexOf('\n', to + 1)
  return doc.slice(from, Math.min(to < 0 ? doc.length : to, from + lines * LINE))
}
export async function scrollbackOf(tab: Tab): Promise<ScreenPreview | null> {
  const port = portOf('terminal.previews')
  if (!port.ok) return null
  const home = (tab.note as { home?: string | null }).home ?? null
  return port.value.scrollback({ id: tab.id, doc: tab.doc, home }).catch(() => null)
}
