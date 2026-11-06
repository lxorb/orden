import { shownNames } from '../tree-order'
import type { Entry } from '../workspace.svelte'
import type { Positioned } from '../workspace/arranged.svelte'
import { joinPath } from '../tauri'
import type { Engine } from './engine'

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
