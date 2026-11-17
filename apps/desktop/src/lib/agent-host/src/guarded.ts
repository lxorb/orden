import { protection } from '../../protect/src/api'
import { Refused } from '../../agent-verbs/src/api'

function refused(shown: string): Refused {
  return new Refused(
    'protected',
    `${shown} is protected: the reader has to unlock it and choose Let agents read in its menu`,
  )
}

export function readable(path: string, shown: string): void {
  if (!protection.agentsMay(path)) throw refused(shown)
}

export function readableAll(path: string, shown: string): void {
  if (!protection.agentsMayAll(path)) throw refused(shown)
}

export const seen = (path: string): boolean => protection.agentsMay(path)
