import { protection } from '../protect/src/api'
import { Refused } from './problem'

export function readable(path: string, shown: string): void {
  if (protection.agentsMay(path)) return
  throw new Refused(
    'protected',
    `${shown} is protected: the reader has to unlock it and choose Let agents read in its menu`,
  )
}

export const seen = (path: string): boolean => protection.agentsMay(path)
