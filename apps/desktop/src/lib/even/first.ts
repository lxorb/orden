/** The two things that have to be true before a line of the app runs.
 *
 *  A module rather than the first statements of `even.ts`, and imported before
 *  anything else there, because of the order JavaScript evaluates modules in: every
 *  static import of a file runs to completion before the file's own first statement
 *  does. So `import App from './App.svelte'` had already built the whole store
 *  graph - the workspace, and with it the device view that reads the open folders,
 *  the recent notes and the icon each space wears - by the time `installLocal()` was
 *  called a few lines below it. Those reads went to the page's own `localStorage`,
 *  which in a packed plugin belongs to a port that never comes back and is always
 *  empty.
 *
 *  Emil, on his phone: *"I don't see the icons of the spaces on the Even Realities
 *  plugin right now."* That was this: the icon was on the account, the account had
 *  handed it over, the plugin had written it down, and the store that reads it had
 *  read an empty storage a second before it was replaced.
 *
 *  Imports here are deliberately shallow - the flag and the storage, and what those
 *  two reach - so that importing this cannot pull an app store in and lose the race
 *  it exists to win. See lib/even/local.ts, and `reread` in workspace/device.svelte.ts
 *  for the half of it a cookie has no room for. */

import { markPlugin } from '../plugin'
import { fillLocal, installLocal } from './local'

// Before anything asks: the settings have a section that only makes sense in front
// of a pair of glasses, and this is what tells them apart. See lib/plugin.
markPlugin()

/** The plugin's own storage, in front of the page's. */
const local = installLocal()

/** The rest of what the phone app kept, which answers seconds later. Whoever cares
 *  that it has landed waits on this; nothing has to.
 *
 *  It never fails: a phone app that answers nothing is the ordinary case of the
 *  plugin being opened in a browser, and what is on the cookie is then all there is.
 *  Settled either way, so a waiter runs either way. */
export const filling: Promise<void> = fillLocal(local).catch(() => undefined)
