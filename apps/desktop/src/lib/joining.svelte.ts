/** Following a link into a space somebody shared.
 *
 *  This is the whole of what is asked of somebody who has never used Nib: they
 *  open the link, Nib emails them a code to check the address, and they are in
 *  the space. There is no sign-up, because proving the address is the sign-up -
 *  and because the membership was written against that address rather than
 *  against an account, it is already theirs by the time they get there.
 *
 *  The link is read out of the address bar, so it works in the web app on any
 *  machine and on a phone. The desktop app registers no URL scheme, so a link
 *  opened there opens the web app instead, and the account it lets somebody into
 *  is the same account; see docs/collaboration.md. */

import { api, type Invitation } from './api'
import { account } from './account.svelte'
import { key, message, t } from './i18n.svelte'
import { prompt } from './prompt.svelte'
import { sync } from './sync.svelte'
import { workspace } from './workspace.svelte'

/** What the mail's link looks like. The token is hexadecimal and long; the
 *  bound is here so that nothing else in the address bar is mistaken for one. */
const PATH = /^\/join\/([a-f0-9]{16,128})$/

class Joining {
  /** What the link is about, so the sign-in can say who shared what. Cleared
   *  once it has been walked through. */
  invitation = $state<Invitation | null>(null)

  private token: string | null = null

  /** Reads the address bar, once, as the app starts. The token is taken out of
   *  the address straight away: a link is followed once, and one left in the
   *  address is one that ends up in a bookmark and in the history. */
  async start() {
    const found = PATH.exec(window.location.pathname)
    if (!found?.[1]) return

    this.token = found[1]
    window.history.replaceState(null, '', '/')

    this.invitation = await api.invitation(this.token).catch(() => null)
    if (!this.invitation) {
      this.token = null
      return
    }

    if (account.signedIn) {
      await this.walkThrough()
      return
    }

    // The address is the only thing anybody is asked for, and an invitation
    // already knows which one it was written to.
    account.email = this.invitation.email ?? ''
    account.open = true
  }

  /** The address is proved. Called by the sign-in the moment a code is
   *  accepted, and by `start` when there was already a session. */
  async walkThrough() {
    const token = this.token
    if (!token || !account.token) return

    this.token = null
    const invitation = this.invitation
    this.invitation = null

    let joined
    try {
      joined = await api.join(account.token, token)
    } catch (error) {
      await tell(t('That link does not open anything'), message(error, t('Ask for another one.')))
      return
    }

    if (joined.waiting) {
      await tell(
        t('Waiting to be let in'),
        t('{who} has been asked about {space}.', {
          who: invitation?.from ?? t('The owner'),
          space: invitation?.space ?? '',
        }),
      )
      return
    }

    const space = joined.space
    if (!space) return

    // The space is on the account now. One pass makes the folder, brings the
    // notes down, and leaves the rail holding it.
    await account.loadSpaces().catch(() => undefined)
    await sync.pass()

    const here = workspace.spaces.find((one) => sync.remoteIdFor(one.root) === space.id)
    if (here) await workspace.showSpace(here.id)
  }
}

/** One sentence and one button, in the sheet every other question uses. */
function tell(title: string, detail: string): Promise<string | null> {
  return prompt.choose({
    title,
    detail,
    options: [{ id: 'done', label: key('Done'), primary: true }],
  })
}

export const joining = new Joining()
