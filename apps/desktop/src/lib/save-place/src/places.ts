import type { Entry } from '@orden/contracts'
import { type MoveTarget, moveTargets, type Space } from '../../tree/src/api'
import { nameFromTitle, samePath } from '../../platform/src/api'
import { type NoteDoc, fileNamed, offeredName } from '../../documents/src/api'

export function fileFor(typed: string, note: NoteDoc, title?: string): string {
  return fileNamed(nameFromTitle(typed) ?? offeredName(note, title), note.kind)
}

export function placesFor(
  tree: Entry | null,
  spaces: readonly Space[],
  here: string | null,
  writable: (path: string) => boolean = () => true,
): MoveTarget[] {
  return moveTargets({ moving: null, tree, spaces, here }).filter((one) => writable(one.id))
}

export function startingPlace(
  places: readonly MoveTarget[],
  home: string | null,
): MoveTarget | null {
  return places.find((one) => home !== null && samePath(one.id, home)) ?? places[0] ?? null
}
