/** Zen's sidebar as nib's: what each space becomes before anything is written.
 *
 *  Zen and nib draw the same picture. A space is a space; its sidebar is the file
 *  list; a tab is a web note, the `.url` file a page kept in nib already is; a
 *  folder is a note that holds notes, which on the disk is a folder the file list
 *  draws as a note (folder-notes.ts). So each Zen space becomes a nib space of the
 *  same name, wearing its icon and its colour, with every tab in it as a web note in
 *  the place Zen's sidebar has it - Essentials, then the pinned tabs and folders,
 *  then the tabs of the day - and that order kept as the list's own arranged order.
 *
 *  - **Essentials** are Zen's tiles above every space, which is what nib's
 *    bookmarks are above the file list: each is a web note at the top of its space
 *    and a bookmark of it. Zen shows one row of them for every space (or one per
 *    container); nib keeps bookmarks per space, so they go to the first space, or
 *    to the first one of their container, rather than a copy into every space.
 *  - **A pinned tab** goes back to where it was pinned; the web note's home is that
 *    address and its `URL` the page it is on now, which is the same two things a web
 *    note in nib keeps (shortcut.ts).
 *  - **An empty folder** is an empty note of its name, since a folder with nothing
 *    in it is not on a disk.
 *  - **A split view** is two tabs side by side; they come over as two tabs, in
 *    the folder the split was in.
 *  - **Containers** have nothing to become: nib browses in one profile, with
 *    private tabs for the rest (docs/web-tabs.md). Said once, where any tab had one.
 *
 *  Nothing but web pages: a tab on `about:`, a file or an extension's page is not
 *  somewhere a web note can point. A site's mark comes along where the session kept
 *  it as a picture; an address of one would be a request to the site at every
 *  launch, so it waits for the page to be opened.
 *
 *  Pure: the session in, the plans out. See migrating.svelte.ts for the writing. The
 *  making is every browser's (sidebar-plan.ts); what is Zen's here is its name. */

import { key } from '../i18n.svelte'
import type { Lost } from './plan'
import { sidebarImport } from './sidebar-plan'
import type { ZenSession } from './zen'

const CONTAINERS: Lost = { text: key('Containers stay in Zen') }

/** What nib makes of a session. `now` is when the web notes say they were kept. */
export function zenImport(session: ZenSession, now: Date) {
  return sidebarImport(session, now, CONTAINERS)
}
