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

import { api, type GivenRole, type RemoteSpace, type Sharing, type SpaceRole } from './api'
import { account } from './account.svelte'
import { copyText } from './clipboard'
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
 *  mark the rail draws. */
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

/** How long the copy button says it copied. */
const COPIED_FOR = 1600

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

  /** Who may reach it, as the account last said. Null while it is being read. */
  who = $state<Sharing | null>(null)
  busy = $state(false)
  error = $state<string | null>(null)

  /** The address being typed into the invite field, and the role beside it. */
  email = $state('')
  role = $state<GivenRole>('write')

  copied = $state(false)
  private copiedTimer: ReturnType<typeof setTimeout> | undefined

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

    await this.run((token) => api.sharing(token, id))
  }

  close() {
    this.open = false
    clearTimeout(this.copiedTimer)
    this.copied = false
  }

  async invite() {
    const address = this.email.trim()
    if (!address) return

    if (await this.change((token, id) => api.invite(token, id, address, this.role))) {
      this.email = ''
    }
  }

  /** The four things the owner can do to somebody, each of which reaches one of
   *  two routes: a member is an address the owner wrote down, and a guest is
   *  whoever followed the link. The sheet hands over the person and does not
   *  have to know which it got. */
  setRole(person: Someone, role: GivenRole) {
    return this.change((token, id) =>
      person.guest
        ? api.setGuestRole(token, id, person.guest, role)
        : api.setMemberRole(token, id, person.email ?? '', role),
    )
  }

  remove(person: Someone) {
    return this.change((token, id) =>
      person.guest
        ? api.removeGuest(token, id, person.guest)
        : api.removeMember(token, id, person.email ?? ''),
    )
  }

  /** Makes the link on the first ask and changes what it hands out afterwards.
   *  The link itself stays the same, so a copy already in somebody's message
   *  keeps working and starts meaning this instead. */
  setLink(role: GivenRole, mode: 'open' | 'approval') {
    return this.change((token, id) => api.setShareLink(token, id, role, mode))
  }

  revoke() {
    return this.change((token, id) => api.revokeShareLink(token, id))
  }

  accept(person: Someone) {
    return this.change((token, id) =>
      person.guest
        ? api.acceptGuest(token, id, person.guest)
        : api.acceptRequest(token, id, person.email ?? ''),
    )
  }

  decline(person: Someone) {
    return this.change((token, id) =>
      person.guest
        ? api.removeGuest(token, id, person.guest)
        : api.declineRequest(token, id, person.email ?? ''),
    )
  }

  async copy() {
    const url = this.who?.link?.url
    if (!url) return

    await copyText(url)
    this.copied = true
    clearTimeout(this.copiedTimer)
    this.copiedTimer = setTimeout(() => {
      this.copied = false
    }, COPIED_FOR)
  }

  /** A change, and then whatever the account says the space now looks like. The
   *  space listing is asked for again as well: a role that changed here changes
   *  what the rail and the editor offer. */
  private async change(work: (token: string, id: string) => Promise<Sharing>): Promise<boolean> {
    const id = this.spaceId
    if (!id) return false

    const done = await this.run((token) => work(token, id))
    if (done) await account.loadSpaces().catch(() => undefined)
    return done
  }

  private async run(work: (token: string) => Promise<Sharing>): Promise<boolean> {
    // The owner's, always: everything on this sheet is theirs to change, and a
    // guest has no account for any of it to be about.
    const token = account.accountToken
    if (!token) return false

    this.busy = true
    this.error = null

    try {
      this.who = await work(token)
      return true
    } catch (error) {
      this.error = message(error, 'could not reach the server')
      return false
    } finally {
      this.busy = false
    }
  }
}

export const share = new Share()

/** Whether a space can be shared from here: it is on the account, and it is
 *  this account's to share. */
export function canShare(space: Space): boolean {
  return !!account.user && !!sync.remoteIdFor(space.root) && roleOf(space.root) === 'owner'
}
