/** Which store a page keeps what websites store in: cookies, logins, `localStorage`,
 *  caches.
 *
 *  Emil, 2026-10-13 (#239): *"currently there's a web data option per space ... usually,
 *  this will only be relevant for a few websites. and these could be maintained as web
 *  notes. so i'd like for this option to be removed. instead, web data should be global,
 *  BUT there should be an option that you can set for a web note / tab when right
 *  clicking on it that gives it independent web data."*
 *
 *  So there is one store every page shares - signed in once, signed in everywhere - and a
 *  web note may keep its own: *Separate web data* in the tab's menu and the file list's
 *  (own-data.ts). The note's file says so (`Nib-Data`, see shortcut.ts), so it is the
 *  note's wherever it is moved, renamed or synced to; its pages go in `note_<id>`, the
 *  same name on every computer. Firefox's containers are the model: a cookie jar of its
 *  own, the history shared.
 *
 *  A space used to choose (global, per space, per site; 2026-09-27). The stores a space
 *  kept are folded into the shared one once, before the first page is built (merged.ts),
 *  so nobody is signed out by the choice going away. */

/** The one history every page adds to and the address field offers from. */
export const HISTORY = 'nib:web-visits'

/** The store a page of a web note goes in: the note's own, or null for the shared one. */
export function ownStore(own: string | null | undefined): string | null {
  return own ? `note_${own}` : null
}

/** A new id for a note's own web data: sixteen hex digits, as shortcut.ts reads one. */
export function freshOwn(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The stores a copy is being read out of, by their note's id, and how many copies:
 *  a tab saved out of a Separate note (`ownFor` in workspace/placing.ts). A store being
 *  read is in use, so setting its note back to Global leaves it; see own-data.ts. */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders from it; read on a press
const copying = new Map<string, number>()

/** Whether the store of `own` is being copied out of now. */
export function isCopying(own: string): boolean {
  return (copying.get(own) ?? 0) > 0
}

/** Runs `copy` while the store of `own` is held as being copied out of. */
export async function copyingOut<T>(own: string, copy: () => Promise<T>): Promise<T> {
  copying.set(own, (copying.get(own) ?? 0) + 1)
  try {
    return await copy()
  } finally {
    const left = (copying.get(own) ?? 1) - 1
    if (left > 0) copying.set(own, left)
    else copying.delete(own)
  }
}

class WebData {
  private merging: Promise<void> | null = null

  /** The store a page goes in, once the stores the spaces kept are merged: the note's own
   *  when its file names one, and otherwise the shared one. */
  async store(own: string | null | undefined): Promise<string | null> {
    await this.merged()
    return ownStore(own)
  }

  /** The history every page shares. */
  history(): string {
    return HISTORY
  }

  /** The stores spaces kept, merged into the shared one: once a run, and at most once
   *  ever on a computer; see merged.ts. */
  merged(): Promise<void> {
    this.merging ??= import('./merged').then((one) => one.mergeOld())
    return this.merging
  }
}

export const webData = new WebData()
