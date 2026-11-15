import { syncStore } from '@orden/contracts'

export interface TodoSpace {
  readonly id: string
  readonly also?: readonly string[]
}

export function todoSpaceOf(space: { readonly id: string; readonly root: string }): TodoSpace {
  const kept = syncStore()?.remoteIdFor(space.root) ?? null
  return kept === null || kept === space.id ? { id: space.id } : { id: kept, also: [space.id] }
}

export const isTodoSpace = (space: TodoSpace, id: string | null): boolean =>
  id !== null && (space.id === id || (space.also?.includes(id) ?? false))
