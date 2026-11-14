import { type MoveTarget, moveTargets, type Space } from '../../move-targets'
import { nameFromTitle, samePath } from '../../platform/src/api'
import type { Entry } from '../../workspace.svelte'
import type { NoteDoc } from '../../workspace/documents.svelte'
import { fileNamed, offeredName } from '../../workspace/drafts'

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
