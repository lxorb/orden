/** Who else is in a space, from this side of the wire.
 *
 *  Two things live here. The first is what everything in the app asks before it
 *  offers to change anything: what may this account do in the folder in front of
 *  it. A space nobody shared, and a space on a machine that is signed out, are
 *  both the reader's own, so the answer is `owner` until the account says
 *  otherwise; nothing in the app has to know that sharing exists in order to
 *  behave when it does.
 *
 *  The second is the Share sheet: the people, the link, and the requests waiting
 *  on the owner. Every change answers with the whole of who may reach the space,
 *  so what is drawn is what came back rather than a guess about what the change
 *  did - which is also what keeps two machines editing the same list honest. */

import {
  api,
  ApiError,
  type GivenRole,
  type RemoteSpace,
  type Sharing,
  type SpaceRole,
} from './api'
import { account } from './account.svelte'
import { message } from './i18n.svelte'
import { rooms } from './rooms.svelte'
import { within } from './sync/mirror'
import { sync } from './sync.svelte'
import { type Origin, originOf, trustsHtml } from './trust'
import type { NoteDoc } from './workspace/documents.svelte'
import { type Space, workspace } from './workspace.svelte'

/** The account's copy of a local folder, once one has been paired with it. */
function remoteOf(root: string): RemoteSpace | null {
  const id = sync.remoteIdFor(root)
  if (!id) return null

  return account.spaces.find((one) => one.id === id) ?? null
}

/** What this account may do in the space that folder mirrors. */
export function roleOf(root: string): SpaceRole {
  return remoteOf(root)?.role ?? 'owner'
}

/** Whether the space has anybody in it besides its owner, which is the quiet
 *  dot on its row in the switcher. */
export function isShared(root: string): boolean {
  return remoteOf(root)?.shared ?? false
}

/** Whether this space can be written in. Everything that offers to change a
 *  note asks this, so a reader is never shown a button that would be refused. */
function canWrite(root: string): boolean {
  return roleOf(root) !== 'read'
}

/** What may be done where a note sits. A path in no space this machine knows
 *  about is this machine's own, so it can be written in. */
export function canWriteAt(path: string): boolean {
  const space = workspace.spaces.find((one) => within(one.root, path) !== null)
  return !space || canWrite(space.root)
}

/** Whether the space a note sits in is one somebody else can reach: shared with
 *  anybody, or somebody else's to begin with. A note in no space at all is this
 *  machine's own. */
function sharedAt(path: string | null): boolean {
  if (path === null) return false

  const space = workspace.spaces.find((one) => within(one.root, path) !== null)
  if (!space) return false

  return isShared(space.root) || roleOf(space.root) !== 'owner'
}

/** Where a document's words came from, as much as this side of the wire knows:
 *  who may reach the space it sits in, whether anybody else is in the file right
 *  now, and whether markup has been pasted into it. What the answer means is
 *  trust.ts, which is the one place that decides it. */
export function originOfDocument(note: NoteDoc): Origin {
  return originOf({
    guest: account.guest !== null,
    pasted: note.pasted,
    shared: sharedAt(note.path),
    peers: (rooms.present[note.key] ?? 0) > 0,
  })
}

/** Whether this document's raw HTML is markup rather than characters. What the
 *  reading view and a canvas card both ask before they render one. */
export function trustsHtmlIn(note: NoteDoc): boolean {
  return trustsHtml(originOfDocument(note))
}

/** Anybody in a space who is not its owner, as the sheet names them: an address
 *  they were invited at, or the guest a link handed out. Exactly one of the two. */
interface Someone {
  email: string | null
  guest: string | null
}

class Share {
  open = $state(false)
  /** The folder the sheet is about, and the space on the account behind it. */
  space = $state<Space | null>(null)
  spaceId = $state<string | null>(null)

  /** Who may reach it, as the account last said. Null while it is being read,
   *  which is when the sheet draws the shape of the rows instead. */
  who = $state<Sharing | null>(null)

  /** What is being asked of the server, named by the row or the control it is
   *  about; null while nothing is.
   *
   *  Named rather than counted, so every button can be told apart from the one
   *  that was pressed: the row being changed says so, the rest go quiet, and a
   *  second press cannot ask for the same change twice while the first is still
   *  in the air. */
  working = $state<string | null>(null)

  error = $state<string | null>(null)

  /** The address being typed into the invite field, and the role beside it. */
  email = $state('')
  role = $state<GivenRole>('write')

  /** Whether anything at all is in flight. What every control that is not the
   *  one being pressed reads. */
  get busy(): boolean {
    return this.working !== null
  }

  /** Whether this is the row or control being changed, so it can say so while
   *  the rest simply go quiet. */
  waiting(about: string): boolean {
    return this.working === about
  }

  async show(space: Space) {
    const id = sync.remoteIdFor(space.root)
    if (!id) return

    this.space = space
    this.spaceId = id
    this.who = null
    this.error = null
    this.email = ''
    this.role = 'write'
    this.open = true

    await this.run((token) => api.sharing(token, id), 'sheet')
  }

  close() {
    this.open = false
  }

  async invite() {
    const address = this.email.trim()
    if (!address) return

    if (await this.change((token, id) => api.invite(token, id, address, this.role), 'invite')) {
      this.email = ''
    }
  }

  /** The four things the owner can do to somebody, each of which reaches one of
   *  two routes: a member is an address the owner wrote down, and a guest is
   *  whoever followed the link. The sheet hands over the person and does not
   *  have to know which it got. */
  setRole(person: Someone, role: GivenRole) {
    return this.change(
      (token, id) =>
        person.guest
          ? api.setGuestRole(token, id, person.guest, role)
          : api.setMemberRole(token, id, person.email ?? '', role),
      whoIs(person),
    )
  }

  remove(person: Someone) {
    return this.change(
      (token, id) =>
        person.guest
          ? api.removeGuest(token, id, person.guest)
          : api.removeMember(token, id, person.email ?? ''),
      whoIs(person),
    )
  }

  /** Makes the link on the first ask and changes what it hands out afterwards.
   *  The link itself stays the same, so a copy already in somebody's message
   *  keeps working and starts meaning this instead. */
  setLink(role: GivenRole, mode: 'open' | 'approval') {
    return this.change((token, id) => api.setShareLink(token, id, role, mode), 'link')
  }

  revoke() {
    return this.change((token, id) => api.revokeShareLink(token, id), 'link')
  }

  accept(person: Someone) {
    return this.change(
      (token, id) =>
        person.guest
          ? api.acceptGuest(token, id, person.guest)
          : api.acceptRequest(token, id, person.email ?? ''),
      whoIs(person),
    )
  }

  decline(person: Someone) {
    return this.change(
      (token, id) =>
        person.guest
          ? api.removeGuest(token, id, person.guest)
          : api.declineRequest(token, id, person.email ?? ''),
      whoIs(person),
    )
  }

  /** A change, and then whatever the account says the space now looks like. The
   *  space listing is asked for again as well: a role that changed here changes
   *  what the switcher and the editor offer. */
  private async change(
    work: (token: string, id: string) => Promise<Sharing>,
    about: string,
  ): Promise<boolean> {
    const id = this.spaceId
    if (!id) return false

    const done = await this.run((token) => work(token, id), about)
    if (done) await account.loadSpaces().catch(() => undefined)
    return done
  }

  private async run(work: (token: string) => Promise<Sharing>, about: string): Promise<boolean> {
    // The owner's, always: everything on this sheet is theirs to change, and a
    // guest has no account for any of it to be about.
    const token = account.accountToken
    if (!token) return false

    // One at a time. Every control goes quiet while one is in flight, so this is
    // the machine agreeing with the screen rather than a second guard.
    if (this.working !== null) return false

    this.working = about
    this.error = null

    try {
      this.who = await work(token)
      return true
    } catch (error) {
      // Somebody who is no longer in the space has already gone, which is what
      // the press was asking for. It is not a failure to report: the list is
      // simply older than the space, so it is read again.
      if (gone(error)) return await this.reread()

      this.error = message(error, 'could not reach the server')
      return false
    } finally {
      this.working = null
    }
  }

  /** The list again, after a change that turned out to have happened already. */
  private async reread(): Promise<boolean> {
    const token = account.accountToken
    const id = this.spaceId
    if (!token || !id) return false

    try {
      this.who = await api.sharing(token, id)
      return true
    } catch {
      // The change itself is not in doubt; only this list is out of date, and it
      // is read again the next time the sheet is opened.
      return false
    }
  }
}

/** What names the row a request is about, so the row that was pressed can say so
 *  while the others go quiet. The same key the sheet draws its rows under. */
function whoIs(person: Someone): string {
  return `person:${person.guest ?? person.email ?? ''}`
}

/** Whether what came back means the person was already out of the space.
 *
 *  A second press on Remove is the ordinary way this happens - the row is still
 *  on screen while the first is in the air - and so is another device having
 *  taken them out a moment ago. Either way what was asked for is now true. */
function gone(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}

export const share = new Share()

/** Whether this account owns the space on the server. Sharing and publishing
 *  both ask it and neither can do anything without it: there is nothing to share
 *  and nothing to put on the web until the folder has a copy on the account, and
 *  a space somebody shared is not the reader's to hand on. */
export function ownsRemotely(space: Space): boolean {
  return !!account.user && !!sync.remoteIdFor(space.root) && roleOf(space.root) === 'owner'
}

/** Whether a space can be shared from here. */
export function canShare(space: Space): boolean {
  return ownsRemotely(space)
}
