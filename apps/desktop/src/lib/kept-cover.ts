import { COVER_KEY, COVER_POSITION_KEY, type Cover, coverPosition } from '@orden/markdown/cover'
import { isMarkdownPath } from './space-paths'
import { workspace } from './workspace.svelte'

export function keptCoverOf(path: string | null | undefined): Cover | null {
  if (!path || !isMarkdownPath(path)) return null
  const meta = workspace.itemMeta.of(path)
  const src = meta?.[COVER_KEY]
  return src ? { src, position: coverPosition(meta[COVER_POSITION_KEY]) } : null
}

export function setCoverPosition(path: string, position: number): void {
  workspace.itemMeta.set(path, { [COVER_POSITION_KEY]: String(position) })
}
