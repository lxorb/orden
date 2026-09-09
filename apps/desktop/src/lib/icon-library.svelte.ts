/** The icon set, held once for everything that draws out of it.
 *
 *  Lucide is far larger than the app around it, so it is a chunk of its own,
 *  fetched the first time something actually wants an icon from it and kept for
 *  the rest of the session. What it has to be as well as loaded once is reactive:
 *  the rows that want it are already on screen when it lands, so the space that
 *  chose a book and the note that chose a rocket draw themselves again the moment
 *  it arrives rather than at the next redraw for some other reason.
 *
 *  One holder rather than one per surface, because a file list has one mark
 *  component per row: a load kept inside the component that draws a mark would be
 *  a load per row of the tree. */

import { type IconNode, keyNamed, loadIcons, shapeFor } from './icons'

class IconLibrary {
  /** Empty until the set has arrived, which is why every reader falls back to
   *  something it can draw without it: a letter for a space, a kind's own mark
   *  for a file. */
  set = $state<Record<string, IconNode>>({})

  private asked = false

  /** Asks for the set, once however often it is called - which is what lets the
   *  caller be a row of a list rather than the list. */
  load() {
    if (this.asked) return
    this.asked = true

    void loadIcons().then((all) => {
      this.set = all
    })
  }

  /** The drawing a space's chosen name means: the library's own key, since that
   *  is what a space keeps. Null until the set is here. */
  spaceShape(chosen: string | null): IconNode | null {
    return shapeFor(this.set, chosen)
  }

  /** The drawing a name written in a note means, in any of the spellings a file
   *  can hold; see keyNamed in icons.ts. */
  shape(written: string): IconNode | null {
    return shapeFor(this.set, keyNamed(this.set, written))
  }
}

export const iconLibrary = new IconLibrary()
