/** The editor each pane is showing, while it is on the page.
 *
 *  A pane builds its own editor and leaves it here, so everything that acts on
 *  "the editor" - the keyboard, the palette, the settings, the formatting bar -
 *  can ask for the one in the pane that has the focus without every component
 *  passing it down through the tree. */

import type { EditorView } from '@nib/editor'
import { SvelteMap } from 'svelte/reactivity'

class Views {
  private readonly held = new SvelteMap<string, EditorView>()

  /** What follows the selection: the formatting bar, once it is on the page.
   *  One hook rather than a prop threaded through the pane tree, which is
   *  recursive and would carry it for no other reason. */
  onSelection: ((view: EditorView) => void) | null = null

  of(paneId: string): EditorView | undefined {
    return this.held.get(paneId)
  }

  put(paneId: string, view: EditorView) {
    this.held.set(paneId, view)
  }

  forget(paneId: string) {
    this.held.delete(paneId)
  }

  /** A pane reporting that its selection moved. */
  moved(view: EditorView) {
    this.onSelection?.(view)
  }
}

export const views = new Views()
