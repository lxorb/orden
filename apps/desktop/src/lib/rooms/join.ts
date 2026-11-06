import { fold, type Replacement } from '@orden/rooms/fold'

export type Meeting =
  | { kind: 'agreed' }
  | { kind: 'take'; change: Replacement }
  | { kind: 'offer'; change: Replacement }
  | { kind: 'apart' }

export interface Base {
  mine: boolean
  theirs: boolean
}

export function meeting(mine: string, theirs: string, base: Base | null): Meeting {
  if (mine === theirs) return { kind: 'agreed' }

  if (!theirs) return { kind: 'offer', change: { from: 0, to: 0, insert: mine } }

  if (!mine) return { kind: 'take', change: { from: 0, to: 0, insert: theirs } }

  if (base === null || base.mine) return answer('take', fold(mine, theirs))

  if (base.theirs) return answer('offer', fold(theirs, mine))

  return { kind: 'apart' }
}

function answer(kind: 'take' | 'offer', change: Replacement | null): Meeting {
  return change ? { kind, change } : { kind: 'agreed' }
}
