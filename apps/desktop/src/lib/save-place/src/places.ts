import type { Entry } from '@orden/contracts'
import { type MoveTarget, moveTargets, type Space } from '../../tree/src/api'
import { nameFromTitle, samePath } from '../../platform/src/api'
import { type NoteDoc, fileNamed, offeredName } from '../../documents/src/api'

export const fileFor = (typed: string, note: NoteDoc, title?: string): string =>
  fileNamed(nameFromTitle(typed) ?? offeredName(note, title), note.kind)

export const placesFor = (
  tree: Entry | null,
  spaces: readonly Space[],
  here: string | null,
  writable: (path: string) => boolean = () => true,
): MoveTarget[] => moveTargets({ moving: null, tree, spaces, here }).filter((one) => writable(one.id))

export const startingPlace = (places: readonly MoveTarget[], home: string | null): MoveTarget | null =>
  places.find((one) => home !== null && samePath(one.id, home)) ?? places[0] ?? null
