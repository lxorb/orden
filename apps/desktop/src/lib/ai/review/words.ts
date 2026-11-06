import { workspace } from '../../workspace.svelte'
import { nameOf } from '../../space-paths'
import type { Edit } from './changes'

const SHOWN = 60

export function titleOf(path: string): string {
  if (path.startsWith('unsaved:')) {
    const key = path.slice('unsaved:'.length)
    return workspace.documents.find((one) => one.key === key)?.name ?? ''
  }
  return nameOf(path).replace(/\.md$/i, '')
}

function firstLine(words: string): string {
  const line = words
    .split('\n')
    .map((one) => one.trim())
    .find(Boolean)
  if (!line) return ''
  return line.length > SHOWN ? `${line.slice(0, SHOWN)}…` : line
}

export function snippetOf(change: Pick<Edit, 'spots'>): string {
  for (const spot of change.spots) {
    const said = firstLine(spot.inserted)
    if (said) return said
  }
  for (const spot of change.spots) {
    const said = firstLine(spot.removed)
    if (said) return said
  }
  return '¶'
}
