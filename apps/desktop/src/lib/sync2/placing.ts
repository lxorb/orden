/** The order somebody arranged a folder's rows into by hand, read from and written to the
 *  places sync v2 keeps on each entry (#1068), for a space whose account keeps them.
 *
 *  The file list speaks of a folder's order as names - the front of the folder, as far
 *  as anybody arranged it (workspace/arranged.svelte.ts) - and the engine keeps a place
 *  on each entry, by id. This is the one seam between the two: a folder's placed rows
 *  read as names, and a drop turned into the places it needs, for the whole folder as it
 *  is drawn so that a row with a place left out of the names still stands where the
 *  drop put it. */

import { shownNames } from '../tree-order'
import type { Entry } from '../workspace.svelte'
import type { Positioned } from '../workspace/arranged.svelte'
import { joinPath } from '../tauri'
import type { Engine } from './engine'

/** The places of the engine's spaces, as the file list's order reads them. `childrenIn`
 *  is a folder's rows as the file list holds them, where it does: what a drop's order is
 *  drawn out to the end of the folder from. */
export function placesOf(
  engine: Engine,
  childrenIn: (root: string, folder: string) => readonly Entry[] | null,
  placed: () => void = () => undefined,
): Positioned {
  const full = (root: string, folder: string) => (folder ? joinPath(root, folder) : root)
  return {
    namesIn: (root, folder) => engine.placedIn(full(root, folder)),
    folders: (root) => engine.placedFolders(root),
    arrange(root, folder, names) {
      const path = full(root, folder)
      if (!engine.keepsPlaces(path)) return null
      const children = childrenIn(root, folder)
      // The names somebody arranged first, as `ordered` draws them, and every other row
      // after them in the folder's own order.
      const drawn = children ? shownNames(children, 'manual', names) : [...names]
      const count = drawn.filter((name) => names.includes(name)).length
      const done = engine.arrange(path, drawn, count).then((made) => {
        if (made) placed()
        return made
      })
      return { drawn, done }
    },
  }
}
