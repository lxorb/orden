import { api, ApiError, type SpaceRole } from './api'
import { arriving } from './arriving.svelte'
import { without } from './records'
import { log } from './log'
import { keep, keepJson, stored, storedText } from './stored'
import { nudgeDelay, pollDelay, RECONCILE_INTERVAL } from './backoff'
import type { Pairing } from './space-pairing'
import { untrack } from 'svelte'
import { account } from './account.svelte'
import { startup } from './startup.svelte'
import { rooms } from './rooms.svelte'
import { t } from './i18n.svelte'
import { modes } from './modes.svelte'
import { invoke, isDesktop, joinPath } from './tauri'
import {
  MIRRORS_KEY,
  type Mirror,
  newMirror,
  savedRecord,
  type Tracked,
  within,
} from './sync/mirror'
import type { Holding } from './sync/holding'
import type { Joined, Waiting } from './sync/pass'
import { record } from './sync/record.svelte'
import type { Folded } from './sync/web-copies'
import { workspace } from './workspace.svelte'
import { sayEntryIds } from './workspace/entry-ids'
import type { FileOp } from './workspace/file-ops'
import { unixLines } from './workspace/documents.svelte'
import { samePath } from './space-paths'

export const STORAGE_KEY = MIRRORS_KEY

export type Status = 'off' | 'idle' | 'syncing' | 'error' | 'offline'

const VERSION = 'nib:sync-version'

type Runner = (typeof import('./sync2/runner.svelte'))['runner']

const V2 = !__EVEN_PLUGIN__

class Sync {
  status = $state<Status>('off')
  lastError = $state<string | null>(null)
  lastSyncedAt = $state<number | null>(null)

  private mirrors = $state.raw<Record<string, Mirror>>({})
  private moving = $state.raw<readonly { path: string; tracked: Tracked }[]>([])
  private timer: ReturnType<typeof setTimeout> | null = null
  private dueAt = 0
  private running = false
  private quiet = 0
  private reconciledAt = 0

  private generation = 0
  private first = false
  private seen = false
  private owner: string | null = null

  private readonly pairing: Pairing = {
    pairs: () =>
      Object.values(this.mirrors).map((one) => ({
        root: one.root,
        spaceId: one.spaceId,
        shared: one.shared,
      })),
    pair: (root, spaceId, shared) => {
      this.mirrors[root] = newMirror(spaceId, root, shared)
    },
    unpair: (root) => {
      this.mirrors = without(this.mirrors, root)
    },
    share: (root, shared) => {
      const mirror = this.mirrors[root]
      if (mirror) mirror.shared = shared
    },
  }

  version = $state<1 | 2>(1)
  private v2: Runner | null = null
  private local: Runner | null = null

  get engine(): Runner | null {
    return V2 ? this.v2 : null
  }
  private unmirror: (() => void) | null = null

  private wantsV2(): boolean {
    if (!V2 || account.guest) return false
    return account.user?.syncVersion === 2 || storedText(VERSION) === '2'
  }

  start() {
    this.generation++
    this.leaveLocal()
    if (this.wantsV2()) {
      this.startV2()
      return
    }
    this.startV1()
  }

  private startV2() {
    if (!V2) return
    const mine = this.generation
    this.version = 2
    arriving.settled()
    void (async () => {
      await startup.turn('rooms')
      const { runner } = await import('./sync2/runner.svelte')
      await known()
      if (mine !== this.generation || !account.user) return
      if (account.user.syncVersion !== 2) {
        this.status = 'offline'
        if (!(await runner.walkBack(() => mine === this.generation))) return
        keep(VERSION, '1')
        this.version = 1
        this.startV1()
        return
      }
      keep(VERSION, '2')
      this.v2 = runner
      this.unmirror = $effect.root(() => {
        $effect(() => {
          const status = runner.status
          const error = runner.lastError
          const at = runner.lastSyncedAt
          untrack(() => {
            this.status = status
            this.lastError = error
            this.lastSyncedAt = at
          })
        })
      })
      await runner.start()
    })()
  }

  private startLocal(mine: number) {
    if (!V2 || !isDesktop) return
    void (async () => {
      await startup.turn('rooms')
      const { runner } = await import('./sync2/runner.svelte')
      await known()
      if (mine !== this.generation || account.user || account.token) return
      this.local = runner
      await runner.startLocal()
    })()
  }

  private leaveLocal() {
    if (!V2 || !isDesktop) return
    this.local = null
    void (async () => {
      await startup.turn('rooms')
      const { runner } = await import('./sync2/runner.svelte')
      await runner.dropLocal()
    })()
  }

  private startV1() {
    this.owner = account.user?.id ?? null
    const held = this.load(this.owner)
    this.mirrors = held.mirrors
    this.seen = held.seen
    this.quiet = 0
    this.reconciledAt = 0
    this.first = true

    document.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('focus', this.onReturn)

    if (this.seen) arriving.settled()
    else arriving.begin()

    this.schedule(0)
  }

  get passing(): boolean {
    return V2 && this.v2 ? this.v2.passing : this.running
  }

  stop() {
    this.generation++
    const mine = this.generation
    let stopping: Promise<void> = Promise.resolve()
    if (V2 && this.v2) {
      const runner = this.v2
      this.v2 = null
      this.unmirror?.()
      this.unmirror = null
      stopping = runner.stop()
    }
    void stopping.then(() => this.startLocal(mine))
    if (this.timer) clearTimeout(this.timer)
    this.timer = null

    document.removeEventListener('visibilitychange', this.onVisibility)
    window.removeEventListener('focus', this.onReturn)

    this.status = 'off'
  }

  private notesOnTheirWay(): number {
    let waiting = 0
    for (const mirror of Object.values(this.mirrors)) {
      if (mirror.cursor !== 0) continue

      waiting += account.spaces.find((one) => one.id === mirror.spaceId)?.notes ?? 0
    }

    return waiting
  }

  private readonly pulling = new Set<string>()
  private readonly toldUnwritten = new Set<string>()

  follow(op: FileOp): Promise<void> | undefined {
    if (V2 && this.v2) return this.v2.follow(op)
    if (V2 && this.local) return this.local.follow(op)
    if (op.op !== 'moved') return undefined
    if (this.pulling.has(`${op.from}\n${op.to}`)) return undefined
    if (op.kind !== 'space') return this.moved(op.from, op.to)

    const name = workspace.spaces.find((one) => samePath(one.root, op.to))?.name
    return name === undefined ? undefined : this.renamed(op.from, op.to, name)
  }

  async renamed(from: string, to: string, name: string) {
    const mirror = this.mirrors[from]
    if (!mirror) return

    mirror.root = to
    this.mirrors = { ...without(this.mirrors, from), [to]: mirror }
    this.save()

    const token = account.token
    if (token) await api.renameSpace(token, mirror.spaceId, name).catch(() => undefined)
  }

  async moved(from: string, to: string) {
    const token = account.token
    if (!token) return

    const moving = this.movingFrom(from, to)
    if (moving.length) this.moving = [...this.moving, ...moving]
    const held = new Set(record.clashes.map((one) => one.id))

    try {
      const { movedHere } = await import('./sync/pass')
      for (const mirror of Object.values(this.mirrors)) {
        if (await movedHere(mirror, token, from, to, held, (one) => record.clash(one))) this.save()
      }
    } finally {
      if (moving.length) this.moving = this.moving.filter((one) => !moving.includes(one))
    }
  }

  private movingFrom(from: string, to: string): { path: string; tracked: Tracked }[] {
    const out: { path: string; tracked: Tracked }[] = []

    for (const mirror of Object.values(this.mirrors)) {
      const was = within(mirror.root, from)
      const now = within(mirror.root, to)
      if (was === null || now === null) continue

      for (const [path, tracked] of Object.entries(mirror.notes)) {
        if (path !== was && !path.startsWith(`${was}/`)) continue
        out.push({ path: joinPath(mirror.root, now + path.slice(was.length)), tracked })
      }
    }

    return out
  }

  async forget(root: string, role: SpaceRole | null) {
    if (V2 && this.local) await this.local.forget(root)
    const spaceId = this.remoteIdFor(root)
    if (spaceId === null) return
    const shared = !(V2 && this.v2) && !!this.mirrors[root]?.shared
    const theirs = shared || (role !== null && role !== 'owner')
    const mine = !shared && role === 'owner'

    if (V2 && this.v2) {
      await this.v2.forget(root)
    } else {
      this.mirrors = without(this.mirrors, root)
      this.save()
    }

    const token = account.token
    if (!token || (!theirs && !mine)) return

    const letting = theirs ? api.leaveSpace(token, spaceId) : api.deleteSpace(token, spaceId)

    await letting.catch(() => undefined)
  }

  async pushIcon(root: string, icon: string | null, tint: string | null = null) {
    const token = account.token
    const spaceId = this.remoteIdFor(root)
    if (!token || spaceId === null) return

    await api.setSpaceIcon(token, spaceId, icon, tint).catch(() => undefined)
    await account.loadSpaces().catch(() => undefined)
  }

  async pushBookmarks(root: string) {
    const token = account.token
    const spaceId = this.remoteIdFor(root)
    if (!token || spaceId === null || this.reads(spaceId)) return

    const list = workspace.bookmarks.of(root)
    const landed = await api.saveBookmarks(token, spaceId, list).then(
      () => true,
      () => false,
    )
    workspace.bookmarks.said(root, landed, list)
  }

  wrote(path: string, content: string): void {
    if (V2 && this.v2) void this.v2.wrote(path, content)
    else if (V2 && this.local) void this.local.wrote(path, content)
    else this.nudge()
  }

  mergeable(path: string): void {
    if (V2) (this.v2 ?? this.local)?.mergeable(path)
  }

  nudge() {
    if (V2 && this.v2) {
      this.v2.nudge()
      return
    }
    if (!this.timer) return

    this.quiet = 0
    this.schedule(nudgeDelay(this.dueAt - Date.now()))
  }

  private readonly onVisibility = () => {
    if (document.hidden) this.schedule()
    else this.onReturn()
  }

  private readonly onReturn = () => {
    if (!this.timer) return

    this.quiet = 0
    this.reconciledAt = 0
    this.schedule(0)
  }

  private schedule(delay = this.delay()) {
    if (this.timer) clearTimeout(this.timer)
    this.dueAt = Date.now() + delay
    this.timer = setTimeout(() => void this.tick(), delay)
  }

  private delay(): number {
    return pollDelay(this.quiet, document.hidden)
  }

  private async tick() {
    const mine = this.generation
    let moved = false

    try {
      moved = await this.pass()
    } catch (error) {
      if (mine === this.generation) {
        this.status = 'error'
        this.lastError = error instanceof Error ? error.message : t('sync failed')
      }
    }

    if (mine !== this.generation) return

    this.quiet = moved ? 0 : Math.min(this.quiet + 1, 8)
    this.schedule()
  }

  async pass(): Promise<boolean> {
    if (V2 && this.v2) return await this.v2.passNow()
    const first = this.first
    this.first = false

    try {
      await this.reconcile()

      if (first) arriving.expect(this.notesOnTheirWay())

      return await this.run()
    } finally {
      if (first) arriving.settled()
    }
  }

  private async reconcile() {
    const token = account.token
    if (!token) return

    const missing = workspace.spaces.some((space) => !this.mirrors[space.root])
    const due = Date.now() - this.reconciledAt >= RECONCILE_INTERVAL

    if (!missing && !due) return

    try {
      await account.loadSpaces()
      this.reconciledAt = Date.now()
    } catch {
      return
    }

    const { pairSpaces } = await import('./space-pairing')
    await pairSpaces(token, this.pairing)

    this.save()
  }

  async pushSpaceOrder() {
    const token = account.token
    if (!token) return

    const order = workspace.spaces
      .map((space) => this.remoteIdFor(space.root))
      .filter((id): id is string => !!id)

    if (!order.length) return

    try {
      await api.reorderSpaces(token, order)
      await account.loadSpaces()
    } catch {
      // The next reconcile will notice; an order is not worth an error banner.
    }
  }

  remoteIdFor(root: string): string | null {
    if (V2 && this.v2) return this.v2.remoteIdFor(root)
    return this.mirrors[root]?.spaceId ?? null
  }

  roleKept(root: string): string | null {
    if (V2 && this.v2) return this.v2.roleKept(root)
    const mirror = this.mirrors[root]
    return mirror && !mirror.shared ? 'owner' : null
  }

  private reads(spaceId: string): boolean {
    return account.spaces.find((one) => one.id === spaceId)?.role === 'read'
  }

  pathOf(id: string): string | null {
    if (V2 && this.v2) return null
    for (const mirror of Object.values(this.mirrors)) {
      for (const [path, held] of Object.entries(mirror.notes)) {
        if (held.id === id) return joinPath(mirror.root, path)
      }
    }
    return null
  }

  entryIdAt(root: string, path: string): string | null {
    return V2 ? (this.v2?.tracked(joinPath(root, path))?.id ?? null) : null
  }

  entryPathOf(root: string, id: string): string | null {
    const file = V2 ? this.v2?.fileOf(id) : null
    return file ? within(root, file) : null
  }

  tracked(path: string): { id: string; version: number; hash: string } | null {
    if (V2 && this.v2) return this.v2.tracked(path)
    for (const mirror of Object.values(this.mirrors)) {
      const relative = within(mirror.root, path)
      const held = relative === null ? undefined : mirror.notes[relative]
      if (held) return { id: held.id, version: held.version, hash: held.hash }
    }

    const moving = this.moving.find((one) => samePath(one.path, path))?.tracked
    return moving ? { id: moving.id, version: moving.version, hash: moving.hash } : null
  }

  async holds(path: string, how: Holding = {}): Promise<boolean> {
    if (V2 && this.v2) return this.v2.holds(path, how)
    for (const mirror of Object.values(this.mirrors)) {
      const relative = within(mirror.root, path)
      if (relative === null) continue
      const { mirrorHolds } = await import('./sync/holding')
      return mirrorHolds(mirror, relative, path, how)
    }
    return false
  }

  private waiting(mirror: Mirror, joined: Joined): Waiting {
    const open = new Set(
      workspace.openNotes
        .map((one) => within(mirror.root, one.path))
        .filter((one): one is string => one !== null),
    )

    return {
      listed: (paths) => arriving.listing(paths),
      notWritten: (path) => this.notWritten(joinPath(mirror.root, path)),
      wrote: (path) => {
        arriving.arrived()
        void workspace.arrived(path)
        void this.refresh(path, joined)
        this.pulled += 1
      },
      save: () => this.save(),
      holdingWrites: (from, run, stalled) => workspace.holdingWrites(from, run, stalled),
      moved: async (from, to) => {
        const key = `${from}\n${to}`
        this.pulling.add(key)
        try {
          await workspace.fileMoved(from, to, 'file')
          await workspace.undone.moved(from, to)
        } finally {
          this.pulling.delete(key)
        }
      },
      wanted: open,
      rule: modes.conflicts,
      clashed: (clash) => {
        record.clash(clash)
        this.clashed += 1
      },
      held: record.held,
      asked: new Set(record.clashes.map((one) => one.id)),
      kept: (path) => workspace.archive.holdsIn(mirror.root, path),
    }
  }

  private async refresh(path: string, joined: Joined) {
    const id = this.tracked(path)?.id
    if (id !== undefined && joined.has(id)) return

    const note = workspace.openNotes.find((one) => one.path === path)?.note
    if (!note || note.dirty) return

    const content = await invoke<string>('read_note', { path }).catch(() => null)
    if (content === null || unixLines(content) === note.text) return
    if (id !== undefined) rooms.letGoUnreached(id)
    workspace.reload(path, content)
  }

  private pulled = 0
  private pushed = 0
  private clashed = 0

  private notWritten(path: string) {
    if (this.toldUnwritten.has(path)) return
    this.toldUnwritten.add(path)
    void import('./sync2/unsynced.svelte').then(({ unsynced }) =>
      unsynced.show(path.split(/[\\/]/).pop() ?? path),
    )
  }

  private noted(mirror: Mirror, began: number, failed: string | null) {
    record.wrote({
      at: began,
      space: workspace.spaces.find((one) => one.root === mirror.root)?.name ?? mirror.root,
      pulled: this.pulled,
      pushed: this.pushed,
      clashed: this.clashed,
      failed,
    })
  }

  async run(): Promise<boolean> {
    if (V2 && this.v2) return await this.v2.passNow()
    if (this.running || !account.token) return false

    const token = account.token
    const mine = this.generation
    const joined: Joined = { has: (id) => rooms.carries(id) }
    this.running = true
    this.status = 'syncing'
    this.lastError = null
    let moved = false as boolean
    let shown = false as boolean

    try {
      const { pull, push } = await import('./sync/pass')
      const { eachDue } = await import('./sync2/rounds')
      const mirrors = new Map(Object.values(this.mirrors).map((one) => [one.root, one]))

      await eachDue(
        new Set(mirrors.keys()),
        () => true,
        async (root) => {
          const mirror = mirrors.get(root)
          if (!mirror) return
          if (!workspace.spaces.some((space) => space.root === mirror.root)) return

          this.pulled = 0
          this.pushed = 0
          this.clashed = 0
          const began = Date.now()

          if (await pull(mirror, token, joined, this.waiting(mirror, joined))) {
            moved = true
            if (mirror.root === workspace.activeSpace?.root) shown = true
          }

          if (this.reads(mirror.spaceId)) {
            this.noted(mirror, began, null)
            return
          }

          const sending = {
            held: record.held,
            asked: new Set(record.clashes.map((one) => one.id)),
            sent: () => (this.pushed += 1),
            refused: (path: string) => this.notWritten(joinPath(mirror.root, path)),
            folded: ({ kept, gone }: Folded) => {
              void this.refresh(kept, joined)
              void workspace.fileGone(gone, 'file')
              if (mirror.root === workspace.activeSpace?.root) shown = true
            },
          }
          if (await push(mirror, token, joined, sending)) moved = true

          mirror.dropped = false
          this.noted(mirror, began, null)
        },
      )

      void import('./pages/carrying').then(({ carryNow, mirroredPages }) =>
        carryNow(
          () => mirroredPages(Object.values(this.mirrors), (id) => this.reads(id)),
          (note, failed) =>
            record.wrote({
              at: Date.now(),
              space: note.space,
              pulled: 0,
              pushed: 0,
              clashed: 0,
              failed,
            }),
        ),
      )

      if (shown) await workspace.loadTree()

      if (moved) await workspace.leaveTheWelcomeNote()

      this.seen = true
      this.save()
      if (mine !== this.generation) return moved

      this.lastSyncedAt = Date.now()
      this.status = Object.keys(this.mirrors).length ? 'idle' : 'off'
    } catch (error) {
      this.save()

      const said = error instanceof Error ? error.message : String(error)
      record.wrote({
        at: Date.now(),
        space: '',
        pulled: this.pulled,
        pushed: this.pushed,
        clashed: this.clashed,
        failed: said,
      })

      if (mine !== this.generation) return moved

      if (error instanceof ApiError && error.status === 401) {
        void account.signOut()
        return moved
      }

      this.status = 'error'
      this.lastError = error instanceof Error ? error.message : t('sync failed')
    } finally {
      this.running = false
    }

    return moved
  }

  private load(accountId: string | null): { mirrors: Record<string, Mirror>; seen: boolean } {
    const saved = savedRecord(stored(STORAGE_KEY))
    if (!saved) return { mirrors: {}, seen: false }

    if (saved.whose !== null && saved.whose !== accountId) return { mirrors: {}, seen: false }

    return { mirrors: saved.mirrors, seen: saved.seen }
  }

  reread() {
    const held = this.load(this.owner)
    let grew = !this.seen && held.seen
    this.seen = this.seen || held.seen

    for (const [root, stored] of Object.entries(held.mirrors)) {
      const mine = this.mirrors[root]
      if (!mine) {
        this.mirrors[root] = stored
        grew = true
        continue
      }

      for (const [path, tracked] of Object.entries(stored.notes)) {
        if (mine.notes[path]) continue

        mine.notes[path] = tracked
        grew = true
      }

      for (const [path, file] of Object.entries(stored.files)) {
        if (mine.files[path]) continue

        mine.files[path] = file
        grew = true
      }

      for (const [path, hash] of Object.entries(stored.offered)) {
        if (mine.offered[path]) continue

        mine.offered[path] = hash
        grew = true
      }
    }

    if (grew) this.save()
  }

  private save() {
    this.mirrors = { ...this.mirrors }

    if (this.write(this.mirrors)) return
    if (this.write(withoutCaches(this.mirrors))) {
      log('warn', 'sync: storage is full, so the note caches went and the cursors stayed')
      return
    }

    log('error', 'sync: storage would take no cursors, so the next pass reads the account again')
  }

  private write(mirrors: Record<string, Mirror>): boolean {
    return keepJson(STORAGE_KEY, {
      account: this.owner,
      seen: this.seen,
      mirrors,
    })
  }
}

function withoutCaches(mirrors: Record<string, Mirror>): Record<string, Mirror> {
  const out: Record<string, Mirror> = {}
  for (const [root, mirror] of Object.entries(mirrors)) {
    out[root] = { ...mirror, notes: {}, files: {}, dropped: true }
  }

  return out
}

function known(): Promise<void> {
  if (account.user || !account.token) return Promise.resolve()
  return new Promise((resolve) => {
    const stop = $effect.root(() => {
      $effect(() => {
        if (!account.user && account.token) return
        untrack(() => {
          queueMicrotask(() => stop())
          resolve()
        })
      })
    })
  })
}

export const sync = new Sync()

workspace.fileOps.follow((op) => (op.heard ? undefined : sync.follow(op)))
workspace.fileOps.follow((op) => (op.heard ? undefined : record.follow(op)))
record.notes = {
  at: (id) => sync.pathOf(id),
  of: (path) => sync.tracked(path)?.id ?? null,
  moved: (from, to) => sync.moved(from, to),
}
sayEntryIds({
  idOf: (root, path) => sync.entryIdAt(root, path),
  pathOf: (root, id) => sync.entryPathOf(root, id),
})
