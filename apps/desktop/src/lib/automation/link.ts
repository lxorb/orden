import { copyText } from '../clipboard'
import { headingAt, lineOf, scanHeadings } from '../outline'
import { relativeTo } from '../space-paths'
import { workspace } from '../workspace.svelte'

export function linkTo(space: string, path: string, heading?: string | null): string {
  const said = new URLSearchParams({ space, path })
  if (heading) said.set('heading', heading)

  return `orden://open?${said.toString()}`
}

export async function copyNoteLink(): Promise<boolean> {
  const note = workspace.active
  const space = workspace.activeSpace
  const path = note?.path
  if (!note || !space || !path) return false

  await copyText(linkTo(space.name, relativeTo(space.root, path), headingAtCaret()))
  return true
}

function headingAtCaret(): string | null {
  const note = workspace.active
  if (!note) return null

  const headings = scanHeadings(note.doc)
  return headings[headingAt(headings, lineOf(note.doc, note.cursor ?? 0))]?.text ?? null
}
