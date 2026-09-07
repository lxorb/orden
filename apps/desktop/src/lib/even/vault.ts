/** The session token, kept where a packed plugin can find it again.
 *
 *  The plugin is the web app, so it keeps its token where the web app keeps it:
 *  in the page's own storage. That is enough in a browser, where the page has an
 *  origin and the origin has a profile that outlives the tab. A packed plugin has
 *  neither. It is loaded from files on the phone, inside an app that decides for
 *  itself what a page it hosts may keep, and the platform promises nothing about
 *  it. Signing in and then being signed out on the next launch is what that looks
 *  like from the outside.
 *
 *  So the token is also handed to the phone app's own store, which is the one
 *  place the platform documents as surviving a reboot, and read back from there
 *  when the page's own storage has come up empty. Whichever of the two survived
 *  signs the reader back in, and neither knows about the other.
 *
 *  Nothing in the plain web build reaches this file, so nothing in the plain web
 *  build pays for it. */

import type { Vault } from '../account.svelte'
import { connectStore } from './sdk'

/** The same key the page's own storage uses. One name for one thing: whichever
 *  store answers, it answers about the same session. */
const KEY = 'nib:session'

/** Kept as the empty string rather than removed, because the host's store has no
 *  way to take a key away and reads an absent one as empty anyway. */
const GONE = ''

export const hostVault: Vault = {
  async read() {
    return (await connectStore())?.read(KEY) ?? null
  },

  async write(token) {
    await (await connectStore())?.write(KEY, token)
  },

  async clear() {
    await (await connectStore())?.write(KEY, GONE)
  },
}
