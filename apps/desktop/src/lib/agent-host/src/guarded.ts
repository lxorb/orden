import { protection } from '../../protect/src/api'
import { Refused } from '../../agent-verbs/src/api'
import { insideSpace } from '../../platform/src/api'

export function readable(path: string, shown: string): void {
  if (protection.agentsMay(path)) return
  throw new Refused(
    'protected',
    `${shown} is protected: the reader has to unlock it and choose Let agents read in its menu`,
  )
}

export function spaceReadable(root: string): void {
  for (const key of Object.keys(protection.ways(root))) {
    const path = key === '' ? root : insideSpace(root, key)
    readable(path, key === '' ? 'This space' : key)
  }
}

export const seen = (path: string): boolean => protection.agentsMay(path)
