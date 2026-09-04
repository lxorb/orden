import { api, ApiError } from './api'
import { NUDGE_DELAY, pollDelay, RECONCILE_INTERVAL } from './backoff'
import { planSpaces } from './space-plan'
import { account } from './account.svelte'
import { t } from './i18n.svelte'
import { invoke } from './tauri'
import { type Entry, workspace } from './workspace.svelte'

const STORAGE_KEY = 'nib:mirrors'

/** What the last sync left on disk, so local edits can be told apart from
 *  remote ones without diffing whole documents. */
interface Tracked {
  id: string
  version: number
  hash: string
}

/** Only read now, to understand what an older version wrote. */
interface Stored {
  mirrors: Record<string, Mirror>
}

/** One local space folder and the remote space it mirrors. Keyed by `root`,
 *  because the folder is the thing that persists across launches. */
interface Mirror {
  spaceId: string
  root: string
  cursor: number
  notes: Record<string, Tracked>
}

export type Status = 'off' | 'idle' | 'syncing' | 'error'

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function join(root: string, path: string): string {
  const separator = root.includes('\\') ? '\\' : '/'
  return `${root}${separator}${path.split('/').join(separator)}`
}

function relative(root: string, absolute: string): string {
  return absolute.slice(root.length).replace(/^[\\/]+/, '').replace(/\\/g, '/')
}

/** Where the other side's copy goes when both changed the same note. */
function conflictPath(path: string): string {
  const stamp = new Date().toISOString().slice(0, 10)
  return path.replace(/(\.[^.\\/]+)$/, ` (from another device ${stamp})$1`)
}

class Sync {
  status = $state<Status>('off')
  lastError = $state<string | null>(null)
  lastSyncedAt = $state<number | null>(null)

  private mirrors: Record<string, Mirror> = {}
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  /** Passes in a row that found nothing. Each one waits longer than the last. */
  private quiet = 0
  private reconciledAt = 0

  start() {
    this.mirrors = this.load()
    this.quiet = 0
    this.reconciledAt = 0

    document.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('focus', this.onReturn)

    this.schedule(0)
  }

  stop() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null

    document.removeEventListener('visibilitychange', this.onVisibility)
    window.removeEventListener('focus', this.onReturn)

    this.status = 'off'
  }

  /** The folder moved. The account's copy follows it rather than the next pass
   *  deciding this is a brand new space and uploading a second one. */
  async renamed(from: string, to: string, name: string) {
    const mirror = this.mirrors[from]
    if (!mirror) return

    delete this.mirrors[from]
    mirror.root = to
    this.mirrors[to] = mirror
    this.save()

    const token = account.token
    if (token) await api.renameSpace(token, mirror.spaceId, name).catch(() => undefined)
  }

  /** Deleting a space here deletes it from the account too. Anything less and
   *  the next pass downloads it straight back, on this machine and every
   *  other one. */
  async forget(root: string) {
    const mirror = this.mirrors[root]
    if (!mirror) return

    delete this.mirrors[root]
    this.save()

    const token = account.token
    if (token) await api.deleteSpace(token, mirror.spaceId).catch(() => undefined)
  }

  /** An icon chosen here, sent up so every other machine shows it too. */
  async pushIcon(root: string, icon: string | null) {
    const token = account.token
    const mirror = this.mirrors[root]
    if (!token || !mirror) return

    await api.setSpaceIcon(token, mirror.spaceId, icon).catch(() => undefined)
    await account.loadSpaces().catch(() => undefined)
  }

  /** Something changed here, so the next pass should not wait out whatever slow
   *  interval the loop had settled into. */
  nudge() {
    if (!this.timer) return

    this.quiet = 0
    this.schedule(NUDGE_DELAY)
  }

  /** Hiding the window re-plans the pending pass at the longer interval;
   *  showing it again syncs at once, so what you look at is never stale. */
  private readonly onVisibility = () => {
    if (document.hidden) this.schedule()
    else this.onReturn()
  }

  private readonly onReturn = () => {
    if (!this.timer) return

    this.quiet = 0
    // Spaces now travel both ways, so coming back to the window is the moment
    // to ask whether the account has any this machine has not seen. One extra
    // request, and only when someone is actually looking.
    this.reconciledAt = 0
    this.schedule(0)
  }

  private schedule(delay = this.delay()) {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.tick(), delay)
  }

  private delay(): number {
    return pollDelay(this.quiet, document.hidden)
  }

  /** Pairs every local space with a remote one, then syncs. */
  private async tick() {
    await this.reconcile()
    const moved = await this.run()

    // Eight doublings is far past either cap; stopping there keeps the shift
    // from overflowing on a client left open for days.
    this.quiet = moved ? 0 : Math.min(this.quiet + 1, 8)
    this.schedule()
  }

  private async reconcile() {
    const token = account.token
    if (!token) return

    // The space list changes when someone makes or deletes one, which is rare.
    // A local space with no mirror yet is the case that cannot wait.
    const missing = workspace.spaces.some((space) => !this.mirrors[space.root])
    const due = Date.now() - this.reconciledAt >= RECONCILE_INTERVAL

    if (!missing && !due) return

    try {
      await account.loadSpaces()
      this.reconciledAt = Date.now()
    } catch {
      return
    }

    // What should happen is worked out on its own, away from the doing, so it
    // can be tested against a plain pair of lists - see `space-plan.ts`.
    const plan = planSpaces({
      local: workspace.spaces.map((space) => ({ name: space.name, root: space.root })),
      remote: account.spaces.map((space) => ({ id: space.id, name: space.name })),
      mirrors: Object.values(this.mirrors).map((one) => ({
        root: one.root,
        spaceId: one.spaceId,
      })),
      deleted: account.deletedSpaces,
    })

    for (const { root, spaceId } of plan.pair) {
      this.mirrors[root] = { spaceId, root, cursor: 0, notes: {} }
    }

    for (const space of plan.upload) {
      const { space: remote } = await api.createSpace(token, space.name)
      this.mirrors[space.root] = { spaceId: remote.id, root: space.root, cursor: 0, notes: {} }
    }

    for (const space of plan.adopt) {
      const root = await workspace.adoptSpace(space.name)
      if (root) this.mirrors[root] = { spaceId: space.id, root, cursor: 0, notes: {} }
    }

    for (const root of plan.drop) delete this.mirrors[root]

    // Missing without a marker: not uploaded yet as far as anyone can tell, so
    // the mirror goes and the next pass sends the folder up again.
    for (const root of plan.detach) delete this.mirrors[root]

    // Deleted on purpose, on another machine. This is the one case where a
    // folder is removed here, and only because the account said so outright.
    for (const root of plan.remove) {
      const space = workspace.spaces.find((one) => one.root === root)
      delete this.mirrors[root]
      if (space) await workspace.deleteSpace(space.id)
    }

    // The icon belongs to the space, so it travels with it. Whatever the
    // account holds wins: it is the one copy every machine can see.
    for (const remote of account.spaces) {
      const mirror = Object.values(this.mirrors).find((one) => one.spaceId === remote.id)
      if (mirror) workspace.applyIcon(mirror.root, remote.icon ?? null)
    }

    // The account already lists spaces in the order it holds them, so adopting
    // that order is what makes a second machine look like the first.
    workspace.applySpaceOrder(account.spaces.map((space) => space.name))

    this.save()
  }

  /** Sends the rail order up. Local spaces the account has never heard of are
   *  simply left out; the server keeps them where they were. */
  async pushSpaceOrder() {
    const token = account.token
    if (!token) return

    const order = workspace.spaces
      .map((space) => this.mirrors[space.root]?.spaceId)
      .filter((id): id is string => !!id)

    if (!order.length) return

    try {
      await api.reorderSpaces(token, order)
      await account.loadSpaces()
    } catch {
      // The next reconcile will notice; an order is not worth an error banner.
    }
  }

  /** The remote space a local folder mirrors, if any. Publishing needs it. */
  remoteIdFor(root: string): string | null {
    return this.mirrors[root]?.spaceId ?? null
  }

  /** One full pass: take what the server has, then offer what we have. */
  /** One full pass: take what the server has, then offer what we have.
   *  Answers whether anything actually moved, which is what paces the loop. */
  async run(): Promise<boolean> {
    if (this.running || !account.token) return false

    this.running = true
    this.status = 'syncing'
    this.lastError = null
    let moved = false

    try {
      for (const mirror of Object.values(this.mirrors)) {
        if (await this.pull(mirror)) moved = true
        if (await this.push(mirror)) moved = true
      }

      this.save()
      this.lastSyncedAt = Date.now()
      this.status = Object.keys(this.mirrors).length ? 'idle' : 'off'
    } catch (error) {
      this.status = 'error'
      this.lastError = error instanceof Error ? error.message : t('sync failed')
    } finally {
      this.running = false
    }

    return moved
  }

  private async pull(mirror: Mirror): Promise<boolean> {
    const token = account.token
    if (!token) return false

    let moved = false

    for (;;) {
      const page = await api.changes(token, mirror.spaceId, mirror.cursor)
      if (page.notes.length) moved = true

      for (const remote of page.notes) {
        const target = join(mirror.root, remote.path)

        if (remote.deleted) {
          if (mirror.notes[remote.path]) {
            await invoke('delete_note', { path: target }).catch(() => undefined)
            delete mirror.notes[remote.path]
          }
          continue
        }

        const tracked = mirror.notes[remote.path]
        if (tracked?.version === remote.version) continue

        const local = await invoke<string>('read_note', { path: target }).catch(() => null)
        const { content } = await api.readNote(token, remote.id)

        // The local file carries edits that never reached the server, and the
        // server moved too. Overwriting here would throw one of them away.
        const diverged = tracked && local !== null && (await sha256(local)) !== tracked.hash

        if (diverged && local !== content) {
          await invoke('write_note', { path: conflictPath(target), content })
          // An empty hash guarantees the push below sends our copy, now based
          // on the version we just saw, so it lands as the newest one.
          mirror.notes[remote.path] = { id: remote.id, version: remote.version, hash: '' }
          continue
        }

        await invoke('write_note', { path: target, content })
        mirror.notes[remote.path] = { id: remote.id, version: remote.version, hash: remote.hash }
      }

      mirror.cursor = page.cursor
      if (!page.more) break
    }

    return moved
  }

  private async push(mirror: Mirror): Promise<boolean> {
    const token = account.token
    if (!token) return false

    const tree = await invoke<Entry>('read_tree', { root: mirror.root }).catch(() => null)
    if (!tree) return false

    const seen = new Set<string>()
    let moved = false

    for (const file of flatten(tree)) {
      const path = relative(mirror.root, file.path)
      seen.add(path)

      const content = await invoke<string>('read_note', { path: file.path })
      const hash = await sha256(content)
      const tracked = mirror.notes[path]

      if (!tracked) {
        const { note } = await api.createNote(token, mirror.spaceId, path, content)
        mirror.notes[path] = { id: note.id, version: note.version, hash: note.hash }
        moved = true
        continue
      }

      if (tracked.hash === hash) continue
      moved = true

      try {
        const { note } = await api.writeNote(token, tracked.id, path, content, tracked.version)
        mirror.notes[path] = { id: note.id, version: note.version, hash: note.hash }
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409) throw error
        await this.keepBoth(mirror, path, tracked, error.body)
      }
    }

    // A file that vanished locally is a delete, not a gap.
    for (const [path, tracked] of Object.entries(mirror.notes)) {
      if (seen.has(path)) continue

      await api.deleteNote(token, tracked.id).catch(() => undefined)
      delete mirror.notes[path]
      moved = true
    }

    return moved
  }

  /** Never silently drop an edit: the other device's copy lands beside ours. */
  private async keepBoth(mirror: Mirror, path: string, tracked: Tracked, conflict: unknown) {
    const token = account.token
    if (!token) return

    const server = conflict as { note?: { version: number; hash: string }; content?: string }
    if (!server?.note) return

    await invoke('write_note', {
      path: conflictPath(join(mirror.root, path)),
      content: server.content ?? '',
    })

    // Our version is now the newer one; write it over the server's.
    const ours = await invoke<string>('read_note', { path: join(mirror.root, path) })
    const { note } = await api.writeNote(token, tracked.id, path, ours, server.note.version)
    mirror.notes[path] = { id: note.id, version: note.version, hash: note.hash }
  }

  private load(): Record<string, Mirror> {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, Mirror> &
        Partial<Stored>

      // Written while the mirrors were wrapped in an object of their own.
      return saved.mirrors ?? (saved as Record<string, Mirror>)
    } catch {
      return {}
    }
  }

  private save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.mirrors))
  }
}

function flatten(entry: Entry): Entry[] {
  const out: Entry[] = []
  const walk = (node: Entry) => {
    for (const child of node.children) {
      if (child.is_dir) walk(child)
      else out.push(child)
    }
  }
  walk(entry)
  return out
}

export const sync = new Sync()
