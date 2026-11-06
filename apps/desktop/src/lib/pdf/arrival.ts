/** Where a PDF another program opened with nib goes.
 *
 *  One already in a space opens where it is, in that space; one from anywhere else
 *  opens with the space that is open, as the copy it holds or as a page note not saved
 *  yet; see handed.ts and src-tauri/src/handed_pdfs.rs.
 *
 *  Pure, so every case is a line of arrival.test.ts; handed.ts acts on the answer. */

import { insideSpace, withinSpace } from '../space-paths'

interface Space {
  id: string
  root: string
}

/** Opened in place, in the space it is in; or brought into a space first. */
export type Arrival =
  { kind: 'open'; spaceId: string; path: string } | { kind: 'bring'; spaceId: string; root: string }

/** Where the PDF at `path` goes, or null where there is no space to put it in.
 *
 *  `writable` says which spaces a copy may go into: not one shared with this account
 *  to be read, which is the owner's to write in. The open space when it may, else the
 *  first that may, else none. */
export function arrivalOf(
  path: string,
  spaces: readonly Space[],
  activeId: string | null,
  writable: (root: string) => boolean = () => true,
): Arrival | null {
  for (const space of spaces) {
    const inside = withinSpace(space.root, path)
    if (inside) return { kind: 'open', spaceId: space.id, path: insideSpace(space.root, inside) }
  }

  const open = spaces.filter((one) => writable(one.root))
  const into = open.find((one) => one.id === activeId) ?? open[0]
  return into ? { kind: 'bring', spaceId: into.id, root: into.root } : null
}
