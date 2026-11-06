import type { SpaceRole, Typing } from './types'

export function mayType(
  role: SpaceRole | null,
  guest: boolean,
  ownsMachine: boolean,
  typing: Typing,
): boolean {
  if (guest) return false
  if (ownsMachine) return true
  return typing === 'writers' && (role === 'write' || role === 'owner')
}
