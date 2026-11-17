import { conflictPath } from '@orden/markdown/paths'
import { type ConflictRule, record, writingDown } from '../../sync-mirror/src/api'

export type Settling = 'offer' | 'take' | 'wait'

export interface Apart {
  path: string
  id: string
  version: number
}

export async function apart(rule: ConflictRule, note: Apart, theirs: string): Promise<Settling> {
  if (!note.path) return 'take'

  if (rule === 'newest') return 'take'

  if (rule === 'ask') {
    record.clash({
      path: note.path,
      id: note.id,
      version: note.version,
      theirs,
      at: Date.now(),
    })
    return 'wait'
  }

  const { writeDown } = await writingDown()
  await writeDown(conflictPath(note.path), theirs)
  return 'offer'
}
