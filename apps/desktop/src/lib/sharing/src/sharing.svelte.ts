import {
  api,
  ApiError,
  type GivenRole,
  type RemoteSpace,
  type SharedItem,
  type Sharing,
  type SpaceRole,
  account,
} from '../../accounts/src/api'
import { message } from '../../ui-kit/src/api'
import { rooms } from '../../collab/src/api'
import { samePath, forget, keepJson, Shared } from '../../platform/src/api'
import { within } from '../../sync/mirror'
import { sync } from '../../sync.svelte'
import { type Origin, originOf, trustsHtml } from '../../trust'
import type { NoteDoc } from '../../workspace/documents.svelte'
import { keeping } from '../../workspace/file-ops'
import { type Space, workspace } from '../../workspace.svelte'

function remoteOf(root: string): RemoteSpace | null {
  const id = sync.remoteIdFor(root)
  if (!id) return null

  return account.spaces.find((one) => one.id === id) ?? null
}

export function roleOf(root: string): SpaceRole | null {
  const id = sync.remoteIdFor(root)
  const listed = id ? account.spaces.find((one) => one.id === id) : undefined
  if (listed) return listed.role

  const kept = (id ? roleIn(sync.roleKept(root)) : null) ?? remembered(root)
  if (id && account.listed) return kept === 'owner' ? 'owner' : null
  if (kept) return kept

  return id ? null : 'owner'
}

const ROLES_KEY = 'orden:space-roles'

function kept(root: string): unknown {
  return keptRoles()[root]
}

function keptRoles(): Record<string, unknown> {
  return roles.get()
}

function rekeep(from: string, to: string | null): void {
  const roles = keptRoles()
  const at = Object.keys(roles).find((root) => samePath(root, from))
  if (at === undefined) return

  const { [at]: one, ...rest } = roles
  keepJson(ROLES_KEY, to === null ? rest : { ...rest, [to]: one })
}

workspace.fileOps.follow(
  keeping({ spaceMoved: (from, to) => rekeep(from, to), forget: (root) => rekeep(root, null) }),
)

function remembered(root: string): SpaceRole | null {
  const one = kept(root)
  return roleIn(one && typeof one === 'object' ? (one as Kept).role : one)
}

interface Kept {
  role: SpaceRole
  shared: boolean
  items?: string[]
  once?: boolean
  onceItems?: string[]
}

function keptAt(root: string): Kept | null {
  const one = kept(root)
  return one && typeof one === 'object' ? (one as Kept) : null
}

const MOST_ONCE_ITEMS = 400

function onceFrom(one: RemoteSpace, before: Kept | null): Pick<Kept, 'once' | 'onceItems'> {
  const was = before ? (before.once ?? before.shared) : false
  const items = new Set([
    ...(before ? (before.onceItems ?? before.items ?? []) : []),
    ...(one.sharedItems ?? []),
    ...(one.onceSharedItems ?? []),
  ])

  return {
    once: was || one.shared || !!one.onceShared,
    onceItems: [...items].slice(0, MOST_ONCE_ITEMS),
  }
}

const roles = new Shared<Record<string, unknown>>(ROLES_KEY, (value) =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {},
)

function roleIn(value: unknown): SpaceRole | null {
  return value === 'owner' || value === 'write' || value === 'read' ? value : null
}

export function rememberRoles(): void {
  const roles: Record<string, Kept> = {}
  let paired = false
  for (const space of workspace.spaces) {
    const id = sync.remoteIdFor(space.root)
    if (!id) continue
    paired = true
    const one = account.spaces.find((listed) => listed.id === id)
    if (one) {
      roles[space.root] = {
        role: one.role,
        shared: one.shared,
        items: one.sharedItems ?? [],
        ...onceFrom(one, keptAt(space.root)),
      }
    }
  }

  if (paired) keepJson(ROLES_KEY, roles)
}

account.forgetWithSession(() => forget(ROLES_KEY))

export function isShared(root: string): boolean {
  return remoteOf(root)?.shared ?? false
}

export function isSharedItem(path: string): boolean {
  const id = sync.tracked(path)?.id
  if (!id) return false

  return account.spaces.some((one) => one.sharedItems?.includes(id))
}

export function canShareItem(path: string | null | undefined): boolean {
  if (!path) return false

  const space = workspace.spaces.find((one) => within(one.root, path) !== null)
  if (!space || !ownsRemotely(space)) return false

  return !!sync.tracked(path)?.id
}

export function othersIn(path: string): boolean {
  for (const tab of workspace.tabs) {
    if (tab.path === path && (rooms.seen[tab.note.key]?.people.length ?? 0) > 0) return true
  }

  return false
}

function canWrite(root: string): boolean {
  const role = roleOf(root)
  return role === 'owner' || role === 'write'
}

export function canWriteAt(path: string): boolean {
  const space = workspace.spaces.find(
    (one) => samePath(one.root, path) || within(one.root, path) !== null,
  )
  return !space || canWrite(space.root)
}

export function canWriteIn(
  note: { path: string | null; shared: string | null; reads?: boolean } | null | undefined,
): boolean {
  if (!note) return true
  if (note.reads) return false
  if (note.shared !== null) return sharedWithYou.mayWrite(note.shared)

  return note.path === null || canWriteAt(note.path)
}

export function reachedByOthers(path: string | null): boolean {
  return reachedAs(path) !== null
}

export function reachedAs(path: string | null): Reach {
  if (path === null) return null

  const space = workspace.spaces.find((one) => within(one.root, path) !== null)
  return space ? reached(space.root, path) : null
}

export type Reach = 'space' | 'note' | null

export function reachedByOthersIn(root: string): boolean {
  const space = workspace.spaces.find((one) => samePath(one.root, root))
  return !!space && reached(space.root, null) !== null
}

function reached(root: string, path: string | null): Reach {
  const unknown = !account.listed || sync.remoteIdFor(root) === null
  const guess = unknown && !remoteOf(root) ? keptShared(root, path) : null
  const once = onceReached(root, path)
  if (guess === 'space' || once === 'space' || isShared(root) || roleOf(root) !== 'owner') {
    return 'space'
  }
  if (guess === 'note' || once === 'note') return 'note'

  const item = path === null ? !!remoteOf(root)?.sharedItems?.length : isSharedItem(path)
  return item ? 'note' : null
}

function keptShared(root: string, path: string | null): Reach {
  const one = kept(root)
  if (one === undefined) return sync.remoteIdFor(root) !== null ? 'space' : null
  if (!one || typeof one !== 'object') return 'space'
  const { shared, items } = one as Kept
  if (shared) return 'space'
  if (!items?.length) return null
  if (path === null) return 'note'
  const id = sync.tracked(path)?.id
  return !id || items.includes(id) ? 'note' : null
}

function onceReached(root: string, path: string | null): Reach {
  const listed = remoteOf(root)
  const held = keptAt(root)
  if (listed?.onceShared === true || held?.once === true) return 'space'

  const items = [...(listed?.onceSharedItems ?? []), ...(held?.onceItems ?? [])]
  if (!items.length) return null
  if (path === null) return 'note'

  const id = sync.tracked(path)?.id
  return id && items.includes(id) ? 'note' : null
}

export function canTrustAgain(space: Space): boolean {
  if (!ownsRemotely(space)) return false

  const listed = remoteOf(space.root)
  if (!listed || listed.shared || listed.sharedItems?.length) return false

  const held = keptAt(space.root)
  if (listed.onceShared === true || held?.once === true) return true
  return (listed.onceSharedItems ?? []).length > 0 || (held?.onceItems ?? []).length > 0
}

export async function trustAgain(space: Space): Promise<void> {
  const token = account.accountToken
  const id = sync.remoteIdFor(space.root)
  if (!token || !id || !canTrustAgain(space)) return

  await api.trustSpace(token, id)

  const listed = account.spaces.find((one) => one.id === id)
  if (listed) Object.assign(listed, { onceShared: false, onceSharedItems: [] })

  const roles = keptRoles()
  const at = Object.keys(roles).find((root) => samePath(root, space.root))
  const one = at === undefined ? null : keptAt(at)
  if (at !== undefined && one) {
    keepJson(ROLES_KEY, { ...roles, [at]: { ...one, once: false, onceItems: [] } })
  }

  await account.loadSpaces().catch(() => undefined)
}

export function originOfDocument(note: NoteDoc): Origin {
  return originOf({
    guest: account.guest !== null,
    pasted: note.pasted,
    shared: note.shared !== null || reachedByOthers(note.path),
    peers: (rooms.present[note.key] ?? 0) > 0,
  })
}

export function trustsHtmlIn(note: NoteDoc): boolean {
  return trustsHtml(originOfDocument(note))
}

export function trustsHtmlAt(path: string | null): boolean {
  return trustsHtml(
    originOf({
      guest: account.guest !== null,
      pasted: false,
      shared: reachedByOthers(path),
      peers: false,
    }),
  )
}

interface Someone {
  email: string | null
  guest: string | null
}

interface Asking {
  token: string
  id: string
  item: string
}

export function addressesIn(typed: string): string[] {
  const said = typed.replace(/(?:"[^"]*"|[^,;<>"]*)\s*<([^<>\s]+)>/g, ' $1 ')
  const all = said.split(/[,;\s]+/).filter(Boolean)
  const keys = all.map((one) => one.toLowerCase())
  return all.filter((one, at) => keys.indexOf(one.toLowerCase()) === at)
}

export function looksLikeAddress(one: string): boolean {
  return /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(one)
}

class Share {
  open = $state(false)
  space = $state<Space | null>(null)
  spaceId = $state<string | null>(null)

  item = $state<{ id: string; path: string } | null>(null)

  who = $state<Sharing | null>(null)

  working = $state<string | null>(null)

  private sheet = 0

  error = $state<string | null>(null)

  email = $state('')
  role = $state<GivenRole>('write')

  wrongAddress = $state(false)

  get busy(): boolean {
    return this.working !== null
  }

  waiting(about: string): boolean {
    return this.working === about
  }

  async show(space: Space) {
    await this.about(space, null)
  }

  async showItem(space: Space, path: string) {
    const id = sync.tracked(path)?.id
    if (!id) return

    await this.about(space, { id, path })
  }

  private async about(space: Space, item: { id: string; path: string } | null) {
    const id = sync.remoteIdFor(space.root)
    if (!id) return

    this.sheet += 1

    this.space = space
    this.spaceId = id
    this.item = item
    this.who = null
    this.error = null
    this.email = ''
    this.wrongAddress = false
    this.role = 'write'
    this.working = null
    this.open = true

    await this.run((asking) => api.sharing(asking.token, asking.id, asking.item), 'sheet')
  }

  close() {
    this.open = false
  }

  async invite() {
    const addresses = addressesIn(this.email)
    if (!addresses.length) return

    this.wrongAddress = addresses.some((one) => !looksLikeAddress(one))
    if (this.wrongAddress) return

    const left = [...addresses]
    while (left.length) {
      const address = left[0] ?? ''
      const role = this.role
      if (
        !(await this.change(
          (asking) => api.invite(asking.token, asking.id, address, role, asking.item),
          'invite',
          false,
        ))
      ) {
        break
      }

      left.shift()
      this.email = left.join(', ')
    }
  }

  resend(person: Someone & { role: GivenRole }) {
    return this.change(
      (asking) => api.invite(asking.token, asking.id, person.email ?? '', person.role, asking.item),
      whoIs(person),
    )
  }

  setRole(person: Someone, role: GivenRole) {
    return this.change(
      ({ token, id, item }) =>
        person.guest
          ? api.setGuestRole(token, id, person.guest, role, item)
          : api.setMemberRole(token, id, person.email ?? '', role, item),
      whoIs(person),
    )
  }

  remove(person: Someone) {
    return this.change(
      ({ token, id, item }) =>
        person.guest
          ? api.removeGuest(token, id, person.guest, item)
          : api.removeMember(token, id, person.email ?? '', item),
      whoIs(person),
    )
  }

  setLink(role: GivenRole, mode: 'open' | 'approval') {
    return this.change(
      ({ token, id, item }) => api.setShareLink(token, id, role, mode, item),
      'link',
    )
  }

  revoke() {
    return this.change(({ token, id, item }) => api.revokeShareLink(token, id, item), 'link')
  }

  reset(role: GivenRole, mode: 'open' | 'approval') {
    return this.change(async ({ token, id, item }) => {
      await api.revokeShareLink(token, id, item)
      return api.setShareLink(token, id, role, mode, item)
    }, 'link')
  }

  accept(person: Someone) {
    return this.change(
      ({ token, id, item }) =>
        person.guest
          ? api.acceptGuest(token, id, person.guest, item)
          : api.acceptRequest(token, id, person.email ?? '', item),
      whoIs(person),
    )
  }

  decline(person: Someone) {
    return this.change(
      ({ token, id, item }) =>
        person.guest
          ? api.removeGuest(token, id, person.guest, item)
          : api.declineRequest(token, id, person.email ?? '', item),
      whoIs(person),
    )
  }

  private async change(
    work: (asking: Asking) => Promise<Sharing>,
    about: string,
    goneIsDone = true,
  ): Promise<boolean> {
    const done = await this.run(work, about, goneIsDone)
    if (done) await account.loadSpaces().catch(() => undefined)
    return done
  }

  private async run(
    work: (asking: Asking) => Promise<Sharing>,
    about: string,
    goneIsDone = true,
  ): Promise<boolean> {
    const token = account.accountToken
    const id = this.spaceId
    if (!token || !id) return false

    if (this.working !== null) return false

    const asking: Asking = { token, id, item: this.item?.id ?? '' }
    const sheet = this.sheet

    this.working = about
    this.error = null

    try {
      return this.landed(sheet, await work(asking))
    } catch (error) {
      if (gone(error) && (await this.reread(asking, sheet)) && goneIsDone) return true

      if (sheet === this.sheet) this.error = message(error, 'could not reach the server')
      return false
    } finally {
      if (sheet === this.sheet) this.working = null
    }
  }

  private landed(sheet: number, who: Sharing): boolean {
    if (sheet !== this.sheet) return false

    this.who = who
    return true
  }

  private async reread(asking: Asking, sheet: number): Promise<boolean> {
    try {
      return this.landed(sheet, await api.sharing(asking.token, asking.id, asking.item))
    } catch {
      return false
    }
  }
}

function whoIs(person: Someone): string {
  return `person:${person.guest ?? person.email ?? ''}`
}

function gone(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}

export const share = new Share()

function ownsRemotely(space: Space): boolean {
  return !!account.user && !!sync.remoteIdFor(space.root) && roleOf(space.root) === 'owner'
}

export function canShare(space: Space): boolean {
  return ownsRemotely(space)
}

export function canPublish(space: Space): boolean {
  return ownsRemotely(space)
}

export async function shareThisFile(path: string) {
  const space = workspace.spaces.find((one) => within(one.root, path) !== null)
  if (!space) return

  await share.showItem(space, path)
}

const ASK_EVERY = 15_000

class SharedWithYou {
  items = $state<SharedItem[]>([])
  opening = $state<string | null>(null)

  private asking: ReturnType<typeof setInterval> | undefined

  private listed = 0

  mayWrite(id: string): boolean {
    return this.items.find((one) => one.id === id)?.role === 'write'
  }

  get byOwner(): { owner: string; items: SharedItem[] }[] {
    const out: { owner: string; items: SharedItem[] }[] = []

    for (const item of this.items) {
      const held = out.find((one) => one.owner === item.owner.name)
      if (held) held.items.push(item)
      else out.push({ owner: item.owner.name, items: [item] })
    }

    return out
  }

  async load() {
    const token = account.token
    if (!token) {
      this.forget()
      return
    }

    const listed = this.listed

    try {
      const { shared } = await api.shared(token)
      if (listed !== this.listed) return

      const before = new Set(this.items.map((one) => one.id))
      this.items = shared

      const now = new Set(shared.map((one) => one.id))
      for (const id of before) if (!now.has(id)) workspace.closeShared(id)

      if (shared.length) this.keepAsking()
      else this.stop()
    } catch {
      // Nothing to say. The next pass asks again.
    }
  }

  stop() {
    clearInterval(this.asking)
    this.asking = undefined
  }

  forget() {
    this.stop()
    this.listed += 1
    this.items = []
  }

  private keepAsking() {
    if (this.asking) return

    this.asking = setInterval(() => void this.load(), ASK_EVERY)
  }

  async open(item: SharedItem) {
    const token = account.token
    if (!token || this.opening) return

    if (workspace.showingShared(item.id)) {
      workspace.openShared(item, '')
      return
    }

    this.opening = item.id
    try {
      const { content } = await api.readNote(token, item.id)
      workspace.openShared(item, content)
    } catch {
      await this.load()
    } finally {
      this.opening = null
    }
  }

  async leave(item: SharedItem) {
    const token = account.token
    if (!token) return

    this.listed += 1
    this.items = this.items.filter((one) => one.id !== item.id)
    workspace.closeShared(item.id)

    try {
      await api.leaveShared(token, item.id)
    } catch {
      await this.load()
    }
  }
}

export const sharedWithYou = new SharedWithYou()

account.forgetWithSession(() => sharedWithYou.forget())
