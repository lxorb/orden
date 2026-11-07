import { untrack } from 'svelte'
import { account } from '../account.svelte'
import { api, ApiError } from '../api'
import { pollDelay, RECONCILE_INTERVAL } from '../backoff'
import { log } from '../log'
import { type Pairing, pairSpaces } from '../space-pairing'
import { readMirror, type Mirror } from '../sync/mirror'
import { isRecord, keepJson, stored } from '../stored'
import { workspace } from '../workspace.svelte'
import type { Doer, FileOp } from '../workspace/file-ops'
import { owesAtTheEnd, owesLast, writing } from '../parting'
import { isDesktop, isNative, joinPath } from '../tauri'
import { keptAway } from '../web/away.svelte'
import { hearWrites } from '../workspace/write-file'
import { onDisk } from '../on-disk'
import { aloneHere, holdThisWindow, keptBudget, TRIM_AFTER } from './budget'
import { links } from '../link-index.svelte'
import { Indexing } from './indexing'
import type { Leaving } from './keeping'
import { forgetIndex, type IndexStore, openIndex } from '../web/index-store'
import { pathKey, samePath } from '../space-paths'
import { followRoots } from '../workspace/roots-moved'
import { oneWriteAt, type Said, windows } from '../windows'
import { sheetArrived } from '../pdf/sheets.svelte'
import { waited } from '../timing'
import { appWorld, lettingGo, readingFor, type Telling } from './app-world'
import type { NoteDoc } from '../workspace/documents.svelte'
import type { PlaneSurface } from '../canvas/shared'
import type { Watched } from './watching'
import { rooms } from '../rooms.svelte'
import { theme } from '../theme.svelte'
import * as Y from 'yjs'
import { asking, type Held, type HeldAnswer, unsyncedToast } from './asking.svelte'
import { attach, attachPlane, meetWords, type PlaneJoin } from './binding'
import { carry, uncarry, whoHere } from './carry'
import { Mirrors } from './mirrors'
import { LiveRelay } from './relay'
import { kindOfName } from './create'
import { MINE } from './docs'
import { Engine, type AwayFile } from './engine'
import type { Query } from '@orden/scan/search/query'
import type { Found } from '@orden/scan/search/walk'
import { type Leadership, leadSync } from './lead'
import { forgetMadeDeviceId, madeDeviceId } from './made-device'
import { Owed, type Owing, takeOwed } from './owed'
import { placesOf } from './placing'
import { type Holding, spend } from '../sync/holding'
import type { Carried } from '../pages/carried'
import { holdsDocument, joinsAs, shapeOf, turn, unixLines } from './kinds'
import { hub } from './hub.svelte'
import { firstPass, mirrorsFrom, type V1Listing, type V1Space } from './migrate'
import {
  carriedFor,
  carriedGone,
  carriedIds,
  carriedRows,
  isLocal,
  LOCAL_STORE,
  localFirst,
  localSpaceId,
} from './local'
import { deviceOfSyncStore, forgetSyncStore, get, openSyncStore, put, remove } from './store'
import { eachDue, reachable, sentAll } from './rounds'
import { Refused } from './transport'
import { pairsFromV1 } from './v1-pairs'
import { usage } from '../usage.svelte'
import { forgetAccount, leaveSpaces } from '../left-spaces'
import { dropLeft, leaveUnsent, ownRoots, unsentRoots } from './left'

type Light = 'off' | 'idle' | 'syncing' | 'error' | 'offline'

const ASKS_AT_MOST = 30_000

const ASK_ALIVE_EVERY = 10_000

const ASK_LONGEST = 10 * 60_000

const SIGN_OUT_WAITS = 10_000

const NUDGE = 2_000

const FALLBACK = 30_000
const HIDDEN_FALLBACK = 5 * 60_000

const MIRRORS = 'orden:mirrors'

const FIRST = 'first:'

function v1Spaces(accountId: string): Map<string, V1Space> {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read once by the first pass; nothing renders from it
  const out = new Map<string, V1Space>()
  const saved = stored(MIRRORS)
  if (!isRecord(saved)) return out
  if (typeof saved.account === 'string' && saved.account !== accountId) return out
  const held = isRecord(saved.mirrors) ? saved.mirrors : saved
  for (const [root, one] of Object.entries(held)) {
    const mirror: Mirror | null = readMirror(root, one)
    if (mirror) {
      out.set(mirror.spaceId, {
        cursor: mirror.cursor,
        notes: mirror.notes,
        ...(mirror.moving ? { moving: mirror.moving } : {}),
        ...(mirror.untold ? { untold: mirror.untold } : {}),
      })
    }
  }
  return out
}

async function wholeV1(root: string, v1: V1Space | null): Promise<V1Space | null> {
  const waiting = (path: string) => /^\.(orden|nib)-moving-/.test(path.split('/').pop() ?? '')
  if (!v1 || (!v1.moving && !Object.keys(v1.notes).some(waiting))) return v1
  const { asidesBack } = await import('../sync/pass')
  return {
    cursor: v1.cursor,
    notes: await asidesBack(root, v1.notes, v1.moving),
    ...(v1.untold ? { untold: v1.untold } : {}),
  }
}

class Runner {
  status = $state<Light>('off')
  lastError = $state<string | null>(null)
  lastSyncedAt = $state<number | null>(null)
  heldNotes = $state.raw<readonly Held[]>([])

  private current: Engine | null = null

  get engine(): Engine | null {
    return this.local ? null : this.current
  }
  private accountId: string | null = null

  get accountNow(): string | null {
    return this.accountId
  }
  private stops: (() => void)[] = []
  private due = new Set<string>()
  private readonly full = new Set<string>()
  private passing_: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private quiet = 0
  private reconciledAt = 0
  private readonly own = new Set<string>()
  private readonly firsts = new Set<string>()
  private readonly bound = new Map<
    string,
    { id: string; part: () => void; plane?: PlaneJoin | null; joining?: boolean }
  >()
  private binding = Promise.resolve()
  private watched: Watched | null = null

  private local = false

  private lane: Promise<unknown> = Promise.resolve()

  private inLane<T>(work: () => Promise<T>): Promise<T> {
    const next = this.lane.then(work)
    this.lane = next.catch(() => undefined)
    return next
  }

  async start(): Promise<void> {
    if (this.local) await this.inLane(() => this.carryLocal())
    if (this.current && this.attempt !== this.leadOf) await this.inLane(() => Promise.resolve())
    const user = account.user
    if (!user || this.current || this.giving) return
    const mine = ++this.attempt
    const live = () => this.attempt === mine
    this.accountId = user.id
    this.hearLeader()
    const giving = new AbortController()
    this.giving = giving
    const held = await this.holdStore()
    const lead = held && !giving.signal.aborted ? await leadSync(giving.signal, user.id) : null
    if (!lead || this.giving !== giving || account.user?.id !== user.id || !live()) {
      lead?.release()
      if (this.giving === giving) this.giving = null
      this.settleStore()
      return
    }
    this.giving = null
    this.lead = lead
    this.leadOf = mine
    this.accountId = user.id
    try {
      const engine = await this.inLane(async () => {
        if (!live()) return null
        await this.carryLocal()
        return this.running(user, live)
      })
      if (engine) await this.tookOver(engine)
      else if (this.lead === lead) this.letGoLead()
    } catch (error) {
      this.letGoLead()
      this.owed.clear()
      throw error
    }
  }

  private giving: AbortController | null = null
  private attempt = 0
  private leadOf = 0
  private lead: Leadership | null = null

  private storeLead: Leadership | null = null
  private storeWait: Promise<Leadership | null> | null = null
  private storeGiving: AbortController | null = null

  private holdStore(): Promise<Leadership | null> {
    if (this.storeLead) return Promise.resolve(this.storeLead)
    if (this.storeWait) return this.storeWait
    const giving = new AbortController()
    this.storeGiving = giving
    const wait = leadSync(giving.signal, LOCAL_STORE).then((lead) => {
      if (this.storeWait === wait) {
        this.storeWait = null
        this.storeGiving = null
      }
      if (!lead || giving.signal.aborted) {
        lead?.release()
        return null
      }
      this.storeLead = lead
      return lead
    })
    this.storeWait = wait
    return wait
  }

  private stopHolding() {
    this.storeGiving?.abort()
    this.storeGiving = null
    this.storeWait = null
  }

  private storeUses = 0

  private async usingStore<T>(work: () => Promise<T>): Promise<T | undefined> {
    this.storeUses += 1
    try {
      if (!(await this.holdStore())) return undefined
      return await work()
    } finally {
      this.storeUses -= 1
      this.settleStore()
    }
  }

  private settleStore() {
    if (this.current || this.lead || this.giving || this.storeWait || this.storeUses) return
    this.storeLead?.release()
    this.storeLead = null
  }

  private carrying = new Map<string, string>()

  private async carryLocal(): Promise<void> {
    if (!this.storeLead) return
    try {
      const engine = this.current
      if (engine && !this.local) return
      if (engine) {
        this.keepCarried(await carriedIds(engine.core.store, isLocal, account.user?.id))
        await this.letGo(true)
      } else {
        if (!isDesktop) return
        const store = await openSyncStore(LOCAL_STORE)
        try {
          this.keepCarried(await carriedIds(store, isLocal, account.user?.id))
        } finally {
          await store.close().catch(() => undefined)
        }
      }
      await forgetSyncStore(LOCAL_STORE)
    } catch (error) {
      log('warn', `sync: the store kept signed out stays - ${String(error)}`)
    }
  }

  private keepCarried(ids: ReadonlyMap<string, string>) {
    this.carriedFrom = null
    for (const [root, kept] of ids) this.carrying.set(root, kept)
  }

  private carriedFrom: string | null = null

  private async carriedIn(engine: Engine) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away within this call
    const carried = new Map(this.carrying)
    this.carrying.clear()
    for (const space of engine.core.spaces.values()) {
      if (!(await this.firstDone(engine, space.id))) continue
      for (const root of carried.keys()) if (samePath(root, space.row.root)) carried.delete(root)
    }
    if (carried.size) await engine.core.commit(carriedRows(carried))
  }

  private async running(user: { id: string }, live: () => boolean): Promise<Engine | null> {
    const store = await openSyncStore(user.id, true, madeDeviceId(user.id))
    const engine = await Engine.start(
      appWorld(() => account.token, this.telling),
      store,
      {
        names: (device) => this.nameOf(device),
      },
    )
    if (!live() || this.accountId !== user.id) {
      await store.close()
      return null
    }
    this.current = engine
    await followRoots(engine.core)
    if (!isNative) {
      const store = await openIndex(user.id).catch(() => null)
      if (store)
        this.indexing = new Indexing(
          engine,
          readingFor(() => account.token),
          store,
        )
      this.indexStore = store
    }
    await this.carriedIn(engine)
    engine.held.changed = (notes) => (this.heldNotes = notes)
    this.heldNotes = engine.held.notes

    const notes = () => this.heldNotes
    this.stops.push(
      asking.connect({
        held: {
          get notes() {
            return notes()
          },
          answer: (id, answer) => this.answer(id, answer),
        },
        store: engine.store,
        copies: engine,
        on: (type, listener) => engine.on(type, listener),
      }),
    )
    this.stops.push(hub.on('poke', (frame) => this.kick(frame.space)))
    this.stops.push(hub.opened(() => this.kick()))
    const back = () => {
      if (document.visibilityState !== 'hidden') this.kick()
    }
    window.addEventListener('focus', back)
    document.addEventListener('visibilitychange', back)
    this.stops.push(() => {
      window.removeEventListener('focus', back)
      document.removeEventListener('visibilitychange', back)
    })
    this.stops.push(this.followOpen())
    this.stops.push(workspace.fileOps.doneBy(this.doer))
    this.stops.push(
      workspace.arranged.placeBy(
        placesOf(
          engine,
          (root, folder) => {
            const tree = workspace.tree
            if (!tree || !samePath(tree.path, root)) return null
            return folder
              ? (workspace.entryAt(joinPath(root, folder))?.children ?? null)
              : tree.children
          },
          () => this.nudge(),
        ),
      ),
    )
    this.stops.push(
      workspace.itemMeta.describeBy({
        describedIn: (root) => engine.describedIn(root),
        describe: (root, patches) => engine.describe(root, patches),
      }),
    )
    rooms.drawn = () => this.rebind()
    this.stops.push(() => (rooms.drawn = null))
    this.stops.push(engine.on('placed', () => this.rebind()))
    if (isDesktop) {
      const { watchFolders } = await import('./watching')
      const watched = watchFolders({
        engine,
        ready: (id) => this.firsts.has(id),
        changed: () => this.nudge(),
        moved: (from, to, kind) => this.telling.moved(from, to, kind),
      })
      this.watched = watched
      this.stops.push(() => {
        watched.stop()
        this.watched = null
      })
    }

    this.status = 'idle'
    this.kick()
    return engine
  }

  async startLocal(): Promise<void> {
    if (account.user) return
    await this.usingStore(() => this.inLane(() => this.startLocalNow()))
  }

  private async startLocalNow(): Promise<void> {
    if (this.current || account.user) return
    const store = await openSyncStore(LOCAL_STORE)
    const engine = await Engine.start(
      appWorld(() => null, this.telling),
      store,
    )
    if (signedIn()) {
      engine.stop()
      await store.close().catch(() => undefined)
      return
    }
    this.local = true
    this.current = engine
    await followRoots(engine.core)
    const from = this.carriedFrom
    const carried = new Map(this.carrying)
    this.carrying.clear()
    this.carriedFrom = null
    if (from !== null && carried.size) await engine.core.commit(carriedRows(carried, from))
    this.stops.push(workspace.fileOps.doneBy(this.doer))
    if (!isDesktop) this.stops.push(this.hearsWrites())
    if (isDesktop) {
      const { watchFolders } = await import('./watching')
      const watched = watchFolders({
        engine,
        ready: (id) => this.firsts.has(id),
        changed: () => this.nudge(),
        moved: (from, to, kind) => this.telling.moved(from, to, kind),
      })
      this.watched = watched
      this.stops.push(() => {
        watched.stop()
        this.watched = null
      })
    }
    this.kick()
  }

  async dropLocal(): Promise<void> {
    await this.usingStore(() =>
      this.inLane(() => (account.user ? this.carryLocal() : Promise.resolve())),
    )
  }

  async deviceOf(accountId: string): Promise<string | null> {
    const engine = this.engine
    if (engine && this.accountId === accountId) return engine.core.store.opened.device
    return await deviceOfSyncStore(accountId).catch(() => null)
  }

  async answer(id: string, answer: HeldAnswer): Promise<string | undefined> {
    const engine = this.current
    if (!engine) return undefined
    const copy = await engine.held.answer(id, answer)
    this.nudge()
    this.rebind()
    if (copy) this.treeStale()
    return copy
  }

  stop(): Promise<void> {
    return this.leaving ?? this.halt()
  }

  private leaving: Promise<void> | null = null

  private halt(keepLead = false): Promise<void> {
    const at = ++this.attempt
    this.giving?.abort()
    this.giving = null
    this.stopHolding()
    this.owed.clear()
    this.seen = { spaces: [], notes: [] }
    this.seenAt = new Map()
    this.noLeader()
    for (const stop of this.hearings.splice(0)) stop()
    return this.inLane(() => this.letGo(keepLead, () => this.attempt !== at))
  }

  private async letGo(keepLead = false, overtaken: () => boolean = () => false): Promise<void> {
    for (const stop of this.stops.splice(0)) stop()
    for (const key of this.carried) uncarry(key)
    this.carried.clear()
    this.full.clear()
    usage.syncFull(false)
    for (const one of this.bound.values()) one.part()
    this.bound.clear()
    clearTimeout(this.timer)
    clearTimeout(this.trimTimer)
    this.awayPaths.clear()
    keptAway.clear()
    this.indexing = null
    this.indexStore?.close()
    this.indexStore = null
    const engine = this.current
    const newer = overtaken()
    this.current = null
    if (!newer) this.accountId = null
    this.local = false
    this.status = 'off'
    if (engine) {
      await engine.quit().catch(() => undefined)
      engine.stop()
      await engine.core.store.close().catch(() => undefined)
    }
    if (keepLead) return
    if (!newer || (this.lead && this.leadOf !== this.attempt)) this.letGoLead()
  }

  private letGoLead() {
    this.lead?.release()
    this.lead = null
    this.settleStore()
  }

  flushing() {
    const engine = this.current
    if (!engine) return
    writing(
      workspace
        .writesSettled()
        .then(() => engine.flush())
        .catch(() => undefined),
    )
  }

  parting() {
    const engine = this.current
    if (!engine) return
    writing(
      workspace
        .writesSettled()
        .then(() => engine.quit())
        .catch(() => undefined),
    )
  }

  rollBack(): Promise<boolean> {
    return this.inLane(async () => {
      if (this.local) await this.letGo(true)
      return await this.rollBackNow()
    })
  }

  private async rollBackNow(): Promise<boolean> {
    const user = account.user
    const token = account.token
    if (!user || !token) return false
    const store = await openSyncStore(user.id, true, madeDeviceId(user.id))
    const engine = await Engine.start(
      appWorld(() => account.token, this.telling),
      store,
    )
    let back = false
    try {
      const kept = await this.kept(engine)
      if (!kept.size) return (back = true)
      if (!(await sentAll(engine, kept, SENDING_ROUNDS, () => waited(SETTLING)))) return false
      const { listings, gone } = await reachable(
        kept,
        (id) => listingOf(token, id),
        async () => (await api.listSpaces(token)).spaces.map((one) => one.id),
      )
      const done = new Set([...kept].filter((id) => !gone.has(id)))
      const mirrors = await this.mirrorsNow(engine, user.id, listings, done, gone)
      back = keepJson(MIRRORS, { account: user.id, seen: true, mirrors })
      return back
    } catch (error) {
      log('warn', `sync: the way back to v1 waits - ${String(error)}`)
      return false
    } finally {
      await engine.quit().catch(() => undefined)
      engine.stop()
      await store.close().catch(() => undefined)
      if (back) {
        this.firsts.clear()
        await forgetSyncStore(user.id).catch(() => undefined)
        if (!isNative) await forgetIndex(user.id)
      }
    }
  }

  async walkBack(alive: () => boolean): Promise<boolean> {
    const walked = await this.usingStore(async () => {
      const lead = await leadSync(undefined, account.user?.id)
      try {
        for (let tries = 0; alive(); tries += 1) {
          if (await this.rollBack().catch(() => false)) return alive()
          await waited(pollDelay(tries, document.hidden))
        }
        return false
      } finally {
        lead?.release()
      }
    })
    return walked ?? false
  }

  private async kept(engine: Engine): Promise<ReadonlySet<string>> {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read once on the way back; nothing renders from it
    const done = new Set<string>()
    for (const id of engine.core.spaces.keys()) {
      if (await this.firstDone(engine, id)) done.add(id)
    }
    return done
  }

  private async mirrorsNow(
    engine: Engine,
    accountId: string,
    listings: ReadonlyMap<string, V1Listing> | null,
    done: ReadonlySet<string>,
    gone: ReadonlySet<string> = new Set(),
  ): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {}
    const saved = stored(MIRRORS)
    if (isRecord(saved) && (typeof saved.account !== 'string' || saved.account === accountId)) {
      const held = isRecord(saved.mirrors) ? saved.mirrors : saved
      for (const [root, one] of Object.entries(held)) {
        const mirror = readMirror(root, one)
        if (mirror && !done.has(mirror.spaceId) && !gone.has(mirror.spaceId)) out[root] = one
      }
    }
    return { ...out, ...(await mirrorsFrom(engine.core, listings, (id) => done.has(id))) }
  }

  signedOut(accountId: string, keepHere = false): Promise<void> {
    this.leaving ??= this.leave(accountId, keepHere).finally(() => (this.leaving = null))
    return this.leaving
  }

  async sentBeforeLeaving(): Promise<boolean> {
    if (isNative) return true
    await workspace.writeNow().catch(() => undefined)
    const engine = this.engine
    if (!engine) {
      await Promise.race([this.passNow().catch(() => false), waited(SIGN_OUT_WAITS)])
      return (await this.ask('unsent', {})) === true ? await leaveUnsent() : true
    }
    const roots = ownRoots(this.accountId)
    const until = Date.now() + SIGN_OUT_WAITS
    for (let round = 0; ; round += 1) {
      if (!(await unsentRoots(engine, roots, (id) => this.firstDone(engine, id))).length)
        return true
      if (round >= SENDING_ROUNDS || Date.now() >= until || this.status === 'offline') break
      if (this.engine !== engine) return true
      await Promise.race([this.passNow().catch(() => false), waited(until - Date.now())])
    }
    return await leaveUnsent()
  }

  private async leave(accountId: string, keepHere: boolean): Promise<void> {
    const engine = this.current
    const roots = ownRoots(accountId)
    if (keepHere) forgetAccount(accountId)
    else leaveSpaces(accountId, roots)
    let sent: string[] = []
    if (engine && !this.local && !isNative && !keepHere) {
      await workspace.writesSettled().catch(() => undefined)
      const unsent = await unsentRoots(engine, roots, (id) => this.firstDone(engine, id))
      sent = roots.filter((root) => !unsent.includes(root))
    }
    if (engine) {
      try {
        const done = await this.kept(engine)
        const mirrors = done.size ? await this.mirrorsNow(engine, accountId, null, done) : null
        if (mirrors) keepJson(MIRRORS, { account: accountId, seen: true, mirrors })
      } catch (error) {
        log('warn', `sync: signing out kept no mirrors - ${String(error)}`)
      }
      if (isDesktop && !this.local) {
        const ids = await carriedIds(engine.core.store, () => true).catch(() => null)
        if (ids) {
          this.carrying.clear()
          this.keepCarried(ids)
          this.carriedFrom = accountId
        }
      }
    }
    const led = !!engine || !!this.lead || !!this.storeLead
    await this.halt(true)
    this.firsts.clear()
    if (led) {
      forgetMadeDeviceId(accountId)
      try {
        await forgetSyncStore(accountId)
        if (sent.length) await dropLeft(sent)
      } finally {
        this.letGoLead()
      }
      if (!isNative) await forgetIndex(accountId)
      return
    }
    const giving = new AbortController()
    const late = setTimeout(() => giving.abort(), SIGN_OUT_WAITS)
    const lead = await leadSync(giving.signal, accountId)
    clearTimeout(late)
    forgetMadeDeviceId(accountId)
    await forgetSyncStore(accountId)
      .catch(() => undefined)
      .finally(() => lead?.release())
    if (!isNative) await forgetIndex(accountId)
  }

  get passing(): boolean {
    return this.passing_ !== null
  }

  async passNow(): Promise<boolean> {
    if (!this.current) {
      return this.leaderId ? (await this.ask('pass', {})) === true : false
    }
    const before = this.lastSyncedAt
    this.kick()
    await this.passing_
    return this.lastSyncedAt !== before
  }

  kick(space?: string) {
    const engine = this.current
    if (!engine) {
      if (this.accountId) this.say('sync-kick', { space })
      return
    }
    if (space) {
      if (engine.core.spaces.has(space)) this.due.add(space)
    } else {
      for (const id of engine.core.spaces.keys()) this.due.add(id)
      this.due.add('')
    }
    this.passing_ ??= this.run().finally(() => {
      this.passing_ = null
      this.schedule()
    })
  }

  nudge() {
    if (!this.current) {
      if (this.accountId) this.say('sync-kick', {})
      return
    }
    this.quiet = 0
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.kick(), NUDGE)
  }

  private schedule() {
    const engine = this.current
    if (!engine) return
    clearTimeout(this.timer)
    const waiting = [...engine.core.spaces.keys()].some((id) => engine.waiting(id))
    const delay = waiting
      ? NUDGE
      : this.local
        ? HIDDEN_FALLBACK
        : hub.state === 'open'
          ? document.hidden
            ? HIDDEN_FALLBACK
            : FALLBACK
          : pollDelay(this.quiet, document.hidden)
    this.timer = setTimeout(() => this.kick(), delay)
  }

  private async run(): Promise<void> {
    const engine = this.current
    if (!engine) return
    this.status = 'syncing'
    this.lastError = null
    let offline = false as boolean
    let moved = false as boolean
    try {
      if (this.due.delete('') || Date.now() - this.reconciledAt >= RECONCILE_INTERVAL) {
        const reconciling = this.local ? this.pairLocal(engine) : this.reconcile(engine)
        await reconciling.catch((error: unknown) => {
          if (!unreachable(error)) throw error
          offline = true
        })
      }
      await eachDue(
        this.due,
        () => this.current === engine,
        async (id) => {
          const space = engine.core.spaces.get(id)
          if (!space) return
          if (!(await this.firstDone(engine, id)) && isLocal(id)) {
            const carried = await carriedFor(engine.core.store, space.row.root, (path) =>
              space.key(path),
            )
            if (!(await localFirst(engine.core, space, carried))) return
            await engine.core.commit([
              put('meta', { key: `${FIRST}${id}`, value: 1 }),
              carriedGone(space.row.root),
            ])
            this.firsts.add(id)
            this.watched?.follow()
            this.watched?.caughtUp(id)
          } else if (!(await this.firstDone(engine, id))) {
            const v1 = await wholeV1(
              space.row.root,
              this.accountId ? (v1Spaces(this.accountId).get(id) ?? null) : null,
            )
            const carried = await carriedFor(engine.core.store, space.row.root, (path) =>
              space.key(path),
            )
            const first = `${FIRST}${id}`
            const done = [put('meta', { key: first, value: 1 }), carriedGone(space.row.root)]
            if (!(await firstPass(engine.core, space, v1, carried, done))) {
              offline = true
              await engine.core.commit([
                ...engine.core.forgetSpace(id),
                ...engine.core.addSpace(id, space.row.root, space.row.role),
                remove('meta', first),
              ])
              return
            }
            this.firsts.add(id)
            this.watched?.follow()
            this.watched?.caughtUp(id)
          }
          const passed = await engine.pass(id)
          await this.awayHeard(engine, true)
          if (passed?.finished) await this.indexHeard(engine)
          if (!this.local) {
            this.placesHeard(engine, space.row.root)
            void this.describedHeard(space.row.root).catch((error: unknown) =>
              log('warn', `sync: metadata not heard: ${String(error)}`),
            )
          }
          if (passed?.full) this.full.add(id)
          else if (passed?.finished) this.full.delete(id)
          for (const one of this.full) if (!engine.core.spaces.has(one)) this.full.delete(one)
          usage.syncFull(this.full.size > 0)
          if (!passed?.finished) offline = true
          if (passed && (passed.pulled || passed.pushed)) moved = true
          if (passed?.pulled && id === this.spaceOnScreen(engine)) await workspace.loadTree()
        },
      )
      this.quiet = moved ? 0 : Math.min(this.quiet + 1, 8)
      if (this.current !== engine) return
      if (this.local) {
        this.status = 'idle'
        return
      }
      void import('../pages/carrying').then(({ carryNow }) =>
        carryNow(
          () => pageNotes(engine),
          (note, failed) => void engine.said(note.space, failed),
        ),
      )
      this.lastSyncedAt = Date.now()
      this.status = offline ? 'offline' : 'idle'
      if (moved) this.sayRows()
      keptAway.offline = offline
      this.trimSoon()
    } catch (error) {
      if (this.current !== engine) return
      if ((error instanceof Refused || error instanceof ApiError) && error.status === 401) {
        void account.signOut()
        return
      }
      log('error', `sync: ${error instanceof Error ? error.message : String(error)}`)
      this.status = 'error'
      this.lastError = error instanceof Error ? error.message : String(error)
    }
  }

  private async describedHeard(root: string) {
    await workspace.itemMeta.fromEngine(root)
    if (!workspace.itemMeta.describes(root)) return
    const { moveOwnKeysSoon } = await import('../workspace/own-keys-moved')
    moveOwnKeysSoon(root, workspace, true)
    const { markOldListsSoon } = await import('../rows/old-lists')
    markOldListsSoon(root, true, workspace)
    const { keepSetextMarked } = await import('../workspace/setext')
    keepSetextMarked(workspace, root)
  }

  private reorders = -1

  private placesHeard(engine: Engine, root: string) {
    workspace.arranged.fromPlaces(root)
    if (engine.core.reorders === this.reorders) return
    this.reorders = engine.core.reorders
    workspace.arranged.repositioned()
  }

  private async firstDone(engine: Engine, id: string): Promise<boolean> {
    if (this.firsts.has(id)) return true
    const [row] = await engine.core.store.read([get('meta', `${FIRST}${id}`)])
    if (row !== null) this.firsts.add(id)
    return row !== null
  }

  private spaceOnScreen(engine: Engine): string | null {
    const root = workspace.activeSpace?.root
    return spaceRooted(engine.core.spaces.values(), root)?.id ?? null
  }

  private async pairLocal(engine: Engine) {
    this.reconciledAt = Date.now()
    const core = engine.core
    const roots = workspace.spaces.map((space) => space.root)
    const changes: Parameters<typeof core.commit>[0][number][] = []
    for (const space of [...core.spaces.values()]) {
      if (!roots.some((root) => samePath(root, space.row.root))) {
        changes.push(...core.forgetSpace(space.id))
      }
    }
    for (const root of roots) {
      if ([...core.spaces.values()].some((space) => samePath(space.row.root, root))) continue
      changes.push(...core.addSpace(localSpaceId(Math.random), root, 'owner'))
    }
    await core.commit(changes)
    this.watched?.follow()
    for (const id of core.spaces.keys()) this.due.add(id)
  }

  private async reconcile(engine: Engine) {
    const token = account.token
    if (!token) return
    await account.loadSpaces()
    this.reconciledAt = Date.now()
    const core = engine.core
    const changes: Parameters<typeof core.commit>[0][number][] = []
    const pairing: Pairing = {
      pairs: () =>
        [...core.spaces.values()].map((space) => ({
          root: space.row.root,
          spaceId: space.id,
          shared: space.row.role !== null && space.row.role !== 'owner',
        })),
      pair: (root, spaceId, shared) => {
        const known = core.spaces.get(spaceId)
        if (known) changes.push(...core.rootMoved(spaceId, root))
        else changes.push(...core.addSpace(spaceId, root, shared ? 'write' : 'owner'))
      },
      unpair: (root) => {
        const space = spaceRooted(core.spaces.values(), root)
        if (space) changes.push(...core.forgetSpace(space.id))
      },
      share: (root, shared) => {
        const space = spaceRooted(core.spaces.values(), root)
        if (!space) return
        const role =
          account.spaces.find((one) => one.id === space.id)?.role ?? (shared ? 'write' : 'owner')
        if (space.row.role === role) return
        space.row = { ...space.row, role }
        changes.push(put('spaces', { ...space.row }))
      },
    }
    if (this.accountId) {
      const paired = pairing.pairs()
      const local = workspace.spaces.map((space) => space.root)
      const remote = account.spaces.map((space) => ({ id: space.id, role: space.role }))
      for (const one of pairsFromV1(stored(MIRRORS), this.accountId, local, remote, paired)) {
        changes.push(...core.addSpace(one.spaceId, one.root, one.role))
      }
    }
    await pairSpaces(token, pairing)
    await core.commit(changes)
    this.watched?.follow()
    for (const id of core.spaces.keys()) this.due.add(id)
    void this.unpairedHeard(core).catch((error: unknown) =>
      log('warn', `sync: spaces kept on this device not heard: ${String(error)}`),
    )
  }

  private async unpairedHeard(core: Engine['core']) {
    const synced = [...core.spaces.values()].map((space) => space.row.root)
    const unpaired = workspace.shownSpaces
      .map((space) => space.root)
      .filter((root) => !synced.some((one) => samePath(one, root)))
    if (!unpaired.length) return
    const { markOldListsSoon } = await import('../rows/old-lists')
    const { moveOwnKeysSoon } = await import('../workspace/own-keys-moved')
    for (const root of unpaired) {
      markOldListsSoon(root, true, workspace)
      moveOwnKeysSoon(root, workspace, false)
    }
  }

  private readonly telling: Telling = {
    holdingWrites: (from, run, stalled) => workspace.holdingWrites(from, run, stalled),
    moved: async (from, to, kind) => {
      this.own.add(`moved:${from}`)
      try {
        await workspace.fileMoved(from, to, kind)
        workspace.heardMove(from, to)
        await workspace.undone.moved(from, to)
      } finally {
        this.own.delete(`moved:${from}`)
      }
    },
    gone: async (path, kind) => {
      this.own.add(`removed:${path}`)
      try {
        await workspace.fileGone(path, kind)
        workspace.heardGone(path)
        this.treeStale()
      } finally {
        this.own.delete(`removed:${path}`)
      }
    },
    written: (path) => {
      this.treeStale()
      sheetArrived(path)
    },
    writing: async (path, text, write) => {
      if (windows.alone) {
        await write()
        return
      }
      await oneWriteAt(path, async () => {
        await write()
        windows.say('words', { path, text })
      })
    },
  }

  private treeTimer: ReturnType<typeof setTimeout> | undefined
  private treeStale() {
    clearTimeout(this.treeTimer)
    this.treeTimer = setTimeout(() => void workspace.loadTree(), 200)
  }

  readonly doer: Doer = async (op, run) => {
    const engine = this.current
    if (!engine || op.kind === 'space' || op.op === 'created') {
      await run()
      return
    }
    try {
      if (op.op === 'moved') {
        await engine.moving(op.from, op.to, async () => {
          await run()
        })
      } else {
        await engine.removing(op.path, async () => {
          const back = await run()
          return typeof back === 'string' && back ? back : op.back
        })
      }
    } finally {
      await this.awayHeard(engine, false)
    }
    this.nudge()
  }

  private awayPaths = new Map<string, string>()

  private awayOwed = false

  private awaySaid = ''

  private async awayHeard(engine: Engine, told: boolean) {
    if (isNative || this.current !== engine) return
    if (engine.core.handPaths.length) {
      this.awayOwed ||= told
      return
    }
    told ||= this.awayOwed
    this.awayOwed = false
    const files = engine.awayFiles()
    const now = new Map(files.map((one) => [one.id, one.path]))
    const was = this.awayPaths
    this.awayPaths = now
    if (told) {
      for (const [id, path] of was) {
        const is = now.get(id)
        if (is !== undefined && is !== path) await this.telling.moved(path, is, 'file')
        else if (is === undefined && !engine.isLive(id)) await this.telling.gone(path, 'file')
      }
    }
    const back = keptAway.keep(files, (path) => this.fetchAway(engine, path))
    const said = files
      .map((one) => `${one.id}\0${one.path}\0${String(one.size)}\0${String(one.modified)}`)
      .join('\n')
    if (said !== this.awaySaid) {
      this.awaySaid = said
      this.sayAway(files)
    }
    if (this.indexing) keptAway.answeredBy(this.indexing.scans(), this.indexing.search)
    if (back.length || files.length !== was.size) this.treeStale()
    for (const path of back) void workspace.arrived(path)
  }

  private async fetchAway(engine: Engine, path: string): Promise<boolean> {
    if (this.current !== engine) return false
    const here = await engine.fetch(path)
    await this.awayHeard(engine, false)
    this.trimSoon()
    return here
  }

  private indexing: Indexing | null = null
  private indexStore: IndexStore | null = null

  private async indexHeard(engine: Engine) {
    const indexing = this.indexing
    if (!indexing || this.current !== engine) return
    const refreshed = await indexing.refresh().catch((error: unknown) => {
      log('warn', `sync: the index stays as it was - ${String(error)}`)
      return []
    })
    if (this.current !== engine || this.indexing !== indexing) return
    keptAway.answeredBy(indexing.scans(), indexing.search)
    for (const one of refreshed) links.indexed(one.root, one.scans)
    if (!engine.keepingFew().length) await this.awayHeard(engine, false)
  }

  private trimTimer: ReturnType<typeof setTimeout> | undefined

  private trimSoon() {
    const engine = this.current
    if (isNative || !engine) return
    clearTimeout(this.trimTimer)
    this.trimTimer = setTimeout(() => {
      void (async () => {
        if (this.current !== engine || !(await aloneHere())) return
        const indexing = this.indexing
        const went = await engine.trim(await keptBudget(), {
          ...lettingGo,
          drop: async (path: string) => {
            await lettingGo.drop(path)
            keptAway.went(path)
          },
          turn: (path: string, run: () => Promise<boolean>) => oneWriteAt(path, run),
          ...(indexing ? { leaving: (one: Leaving) => indexing.leaving(one) } : {}),
        })
        if (went) await this.awayHeard(engine, false)
      })().catch((error: unknown) => log('warn', `sync: words kept stayed - ${String(error)}`))
    }, TRIM_AFTER)
  }

  follow(op: FileOp): Promise<void> | undefined {
    const engine = this.current
    if (!engine) {
      if (this.owedTo) {
        const at = op.op === 'moved' ? op.from : op.op === 'removed' ? op.path : null
        const entry = at === null ? undefined : this.seenAt.get(pathKey(at))?.id
        this.owed.add({ kind: 'op', op: withoutKey(op), ...(entry ? { entry } : {}) })
      }
      return undefined
    }
    const key =
      op.op === 'moved' ? `moved:${op.from}` : op.op === 'removed' ? `removed:${op.path}` : ''
    if (key && this.own.has(key)) return undefined

    const done = (async () => {
      if (op.op === 'created') {
        const document = op.key ? workspace.documents.find((one) => one.key === op.key) : undefined
        const text =
          op.kind === 'folder' || !holdsDocument(kindOfName(op.path))
            ? undefined
            : (document?.latest ?? (await engine.core.world.disk.read(op.path)) ?? '')
        const mergeable = this.mergeables.delete(op.path) ? '' : undefined
        if (!(op.back && (await engine.restored(op.path, op.back)))) {
          await engine.created(op.path, op.kind === 'folder', text, mergeable)
        }
        this.rebind()
      } else if (op.op === 'moved') {
        if (op.kind === 'space') {
          const space = spaceRooted(engine.core.spaces.values(), op.from)
          if (space) {
            await engine.core.commit(engine.core.rootMoved(space.id, op.to))
            void this.named(space.id, op.to)
          }
        } else {
          await engine.moved(op.from, op.to)
        }
      } else if (op.kind !== 'space') {
        await engine.removed(op.path, op.back)
      }
      this.nudge()
    })()
    return done.catch((error: unknown) => {
      log('error', `sync: ${op.op} - ${String(error)}`)
    })
  }

  private readonly mergeables = new Set<string>()

  mergeable(path: string) {
    if (!this.engine && this.accountId) this.say('sync-mergeable', { path })
    this.mergeables.add(path)
  }

  async wrote(path: string, text: string): Promise<void> {
    const engine = this.current
    if (!engine) {
      if (this.owedTo) this.owed.add({ kind: 'wrote', path, text })
      return
    }
    await engine.saved(path, text).catch((error: unknown) => {
      log('error', `sync: saved ${path} - ${String(error)}`)
    })
    this.nudge()
  }

  private async named(spaceId: string, root: string) {
    const token = account.token
    const accountId = account.user?.id
    const listed = account.spaces.find((one) => one.id === spaceId)
    const name = workspace.spaces.find((one) => samePath(one.root, root))?.name
    if (!token || !accountId || listed?.role !== 'owner' || !name || listed.name === name) return
    const { sendName } = await import('../space-owed')
    await sendName(token, accountId, spaceId, name)
    await account.loadSpaces().catch(() => undefined)
  }

  remoteIdFor(root: string): string | null {
    if (!this.engine) return this.seen.spaces.find((one) => samePath(one.root, root))?.id ?? null
    return spaceRooted(this.engine.core.spaces.values(), root)?.id ?? null
  }

  roleKept(root: string): string | null {
    if (!this.engine) return this.seen.spaces.find((one) => samePath(one.root, root))?.role ?? null
    return spaceRooted(this.engine.core.spaces.values(), root)?.row.role ?? null
  }

  fileOf(id: string): string | null {
    if (!this.engine) return this.seen.notes.find((one) => one.id === id)?.path ?? null
    for (const space of this.engine.core.spaces.values()) {
      const local = space.entries.get(id)?.local_path
      if (local && space.isLive(id)) return joinPath(space.row.root, local)
    }
    return null
  }

  tracked(path: string): { id: string; version: number; hash: string } | null {
    if (!this.engine) return this.seenAt.get(pathKey(path)) ?? null
    const engine = this.engine
    const entry = engine.entryAt(path)
    if (entry?.seq == null) return null
    return {
      id: entry.id,
      version: engine.core.numbers.get(entry.id)?.seq ?? 0,
      hash: entry.written_hash ?? '',
    }
  }

  async idAt(path: string): Promise<IdAt> {
    if (this.engine) return idIn(this.engine, path, this.reconciledAt > 0)
    if (!this.accountId || !this.leaderId) return { none: 'not-running' }
    const said = await this.ask('id-at', { path })
    return isIdAt(said) ? said : { none: 'not-running' }
  }

  async holds(path: string, how: Holding = {}): Promise<boolean> {
    if (!this.engine && this.accountId) return (await this.ask('holds', { path })) === true
    const engine = this.engine
    if (keptAway.at(path)) return true
    const entry = engine?.entryAt(path)
    if (!engine || entry?.seq == null || entry.deleted || !entry.written_hash) {
      return false
    }
    const core = engine.core
    if (core.isHeld(entry.id)) return false

    if (holdsDocument(entry.kind)) {
      if (core.hasPending(entry.id)) return false
      const words = await core.world.disk.read(path)
      if (words === null || !spend(how, words.length)) return false
      return (await core.world.digest(unixLines(words))) === entry.written_hash
    }

    if (core.touched.has(entry.id) || entry.file_key !== entry.written_hash) return false
    const blobs = core.world.blobs
    if (!blobs || (how.budget && (entry.size ?? Infinity) > how.budget.left)) return false
    const bytes = await blobs.read(path)
    if (!bytes || !spend(how, bytes.byteLength)) return false
    return (await blobs.hash(bytes)) === entry.written_hash
  }

  async forget(root: string): Promise<void> {
    if (!this.current && this.accountId) {
      await this.ask('forget', { root })
      return
    }
    const engine = this.current
    const space = engine ? spaceRooted(engine.core.spaces.values(), root) : undefined
    if (engine && space) await engine.core.commit(engine.core.forgetSpace(space.id))
  }

  private names: Promise<Map<string, string>> | null = null
  private async nameOf(device: string | null): Promise<string> {
    if (!device) return ''
    const token = account.token
    if (!token) return ''
    if (!this.names) {
      const asked = (async () => {
        const { request } = await import('../api')
        const listed = await request<{ devices?: { id: string; name: string }[] }>('/v2/devices', {
          token,
        })
        return new Map((listed.devices ?? []).map((one) => [one.id, one.name]))
      })()
      this.names = asked
      asked.catch(() => {
        if (this.names === asked) this.names = null
      })
    }
    const names = await this.names.catch(() => null)
    return names?.get(device) ?? ''
  }

  private seen: Rows = { spaces: [], notes: [] }
  private seenAt = $state.raw(new Map<string, { id: string; version: number; hash: string }>())
  private readonly relay = new LiveRelay((kind, what) => this.say(kind, what))
  private readonly mirrors = new Mirrors({
    say: (kind, what) => this.say(kind, what),
    ask: (what, args) => this.ask(what, args),
    who: whoHere,
    scheme: () => theme.current,
  })
  private readonly owed = new Owed((item) => this.say('sync-owed', { item }))
  private leaderId: string | null = null
  private beat: ReturnType<typeof setInterval> | undefined

  private get owedTo(): boolean {
    return !!this.giving || !!this.lead || !!this.leaderId
  }

  private say(kind: string, what: Record<string, unknown> = {}) {
    windows.say(kind, { ...what, account: this.accountId })
  }

  private hear(kind: string, listener: (said: Said) => void) {
    return windows.hear(kind, (said) => {
      if (this.accountId && said.account === this.accountId) listener(said)
    })
  }

  private leaderIs(id: unknown) {
    if (typeof id !== 'string' || this.engine) return
    this.leaderId = id
    this.beat ??= setInterval(() => this.lookedAt(), FALLBACK)
  }

  private noLeader() {
    this.leaderId = null
    clearInterval(this.beat)
    this.beat = undefined
    for (const answer of [...this.asked.values()]) answer(null)
    this.mirrors.clear()
  }

  private lookedAt() {
    if (!this.engine && this.leaderId && document.visibilityState !== 'hidden') {
      this.say('sync-kick')
    }
  }
  private readonly hearings: (() => void)[] = []
  private readonly asked = new Map<string, (value: unknown) => void>()
  private taking: Promise<unknown> = Promise.resolve()

  private readonly parts = new Map<string, (value: unknown) => void>()
  private readonly alive = new Map<string, () => void>()

  private ask(
    what: string,
    args: Record<string, unknown>,
    part?: (value: unknown) => void,
  ): Promise<unknown> {
    if (!this.leaderId) return Promise.resolve(null)
    return new Promise((resolve) => {
      const id = crypto.randomUUID()
      let timer: ReturnType<typeof setTimeout> | undefined
      const done = (value: unknown) => {
        clearTimeout(timer)
        clearTimeout(longest)
        this.asked.delete(id)
        this.parts.delete(id)
        this.alive.delete(id)
        resolve(value)
      }
      const wait = () => {
        clearTimeout(timer)
        timer = setTimeout(() => done(null), ASKS_AT_MOST)
      }
      wait()
      const longest = setTimeout(() => done(null), ASK_LONGEST)
      this.asked.set(id, done)
      this.alive.set(id, wait)
      if (part) {
        this.parts.set(id, (value) => {
          wait()
          part(value)
        })
      }
      this.say('sync-ask', { id, what, args })
    })
  }

  private hearsWrites(): () => void {
    return hearWrites({
      there: (path) => onDisk(path),
      made: (path) => workspace.fileCame(path, 'file'),
      wrote: (path, content) => void this.wrote(path, content),
    })
  }

  private hearLeader() {
    if (!isNative) holdThisWindow()
    if (this.hearings.length) return
    if (!isDesktop) this.hearings.push(this.hearsWrites())
    if (typeof window !== 'undefined') {
      const back = () => this.lookedAt()
      window.addEventListener('focus', back)
      document.addEventListener('visibilitychange', back)
      this.hearings.push(() => {
        window.removeEventListener('focus', back)
        document.removeEventListener('visibilitychange', back)
      })
    }
    this.hearings.push(
      windows.hear('bye', (said) => {
        if (said.from === this.leaderId) this.noLeader()
      }),
      this.hear('sync-leader', (said) => {
        this.leaderIs(said.from)
        this.owed.resend()
        this.say('sync-hello')
        this.mirrors.restart()
      }),
      this.hear('live-down', (said) => {
        if (!this.engine) this.mirrors.heard(said)
      }),
      this.hear('live-again', (said) => {
        if (!this.engine && typeof said.id === 'string') this.mirrors.again(said.id)
      }),
      this.hear('live-hello', (said) => {
        if (!this.engine) this.mirrors.hello(said.id)
      }),
      this.followMirrored(),
      this.hear('sync-took', (said) => {
        if (said.to === windows.me && typeof said.id === 'string') this.owed.done(said.id)
      }),
      this.hear('sync-said', (said) => {
        if (said.to === windows.me && typeof said.id === 'string') {
          this.asked.get(said.id)?.(said.value)
        }
      }),
      this.hear('sync-part', (said) => {
        if (said.to === windows.me && typeof said.id === 'string') {
          this.parts.get(said.id)?.(said.value)
        }
      }),
      this.hear('sync-alive', (said) => {
        if (said.to === windows.me && typeof said.id === 'string') this.alive.get(said.id)?.()
      }),
      this.hear('sync-light', (said) => {
        if (this.engine) return
        this.leaderIs(said.from)
        this.status = said.status as Light
        this.lastError = (said.lastError as string | null) ?? null
        this.lastSyncedAt = (said.lastSyncedAt as number | null) ?? null
      }),
      this.hear('sync-away', (said) => {
        if (this.engine) return
        this.leaderIs(said.from)
        this.heardAway(said.files)
      }),
      this.hear('sync-rows', (said) => {
        if (this.engine) return
        this.leaderIs(said.from)
        this.seen = said.rows as Rows
        this.seenAt = new Map(
          this.seen.notes.map(({ path, id, version, hash }) => [
            pathKey(path),
            { id, version, hash },
          ]),
        )
        this.mirrors.unjoined()
      }),
    )
    this.say('sync-hello')
  }

  private async tookOver(engine: Engine) {
    this.noLeader()
    this.stops.push(
      this.hear('live-want', (said) => {
        const ids = Array.isArray(said.ids)
          ? said.ids.filter((one): one is string => typeof one === 'string')
          : []
        if (typeof said.from === 'string' && this.relay.want(said.from, ids)) this.rebind()
      }),
      this.hear('live-up', (said) => {
        if (typeof said.from === 'string') this.relay.up(said.from, said)
      }),
      windows.hear('bye', (said) => {
        if (typeof said.from === 'string' && this.relay.gone(said.from)) this.rebind()
      }),
      () => this.relay.stop(),
      this.hear('sync-owed', (said) => {
        const item = said.item as Owing
        this.inTurn(async () => {
          await this.took(engine, item, typeof said.from === 'string' ? said.from : '')
          this.say('sync-took', { id: item.id, to: said.from })
        })
      }),
      this.hear('sync-kick', (said) => {
        this.kick(typeof said.space === 'string' ? said.space : undefined)
      }),
      this.hear('sync-mergeable', (said) => {
        if (typeof said.path === 'string') this.mergeables.add(said.path)
      }),
      this.hear('sync-ask', (said) => this.heardAsk(said)),
      this.hear('sync-hello', () => {
        this.sayAll()
        if (!isNative && engine.core.world.lazy) this.kick()
      }),
      $effect.root(() => {
        $effect(() => {
          const said = this.light()
          untrack(() => this.say('sync-light', said))
        })
      }),
    )
    this.say('sync-leader')
    this.sayAll()
    for (const item of this.owed.drain()) {
      await this.took(engine, item).catch((error: unknown) => {
        log('error', `sync: ${String(error)}`)
      })
    }
  }

  private heardAsk(said: Said) {
    const beat = setInterval(() => {
      this.say('sync-alive', { id: said.id, to: said.from })
    }, ASK_ALIVE_EVERY)
    const answer = async () => {
      try {
        this.say('sync-said', {
          id: said.id,
          to: said.from,
          value: await this.answering(said).catch(() => null),
        })
      } finally {
        clearInterval(beat)
      }
    }
    if (said.what === 'search-away') void answer()
    else this.inTurn(answer)
  }

  private inTurn(run: () => Promise<void>) {
    this.taking = this.taking.then(run).catch((error: unknown) => {
      log('error', `sync: another window's - ${String(error)}`)
    })
  }

  private async took(engine: Engine, item: Owing, from = ''): Promise<void> {
    const what = item.what
    const id = what.kind === 'wrote' ? engine.entryAt(what.path)?.id : undefined
    if (what.kind === 'wrote' && id !== undefined && this.relay.joined(from, id)) return
    if (what.kind === 'wrote' && id !== undefined && this.bound.has(`${RELAY}${id}`)) {
      await engine.foldWritten(what.path)
    } else {
      await takeOwed(engine, item, (op) => this.follow(op))
    }
    this.nudge()
  }

  private async answering(said: Said): Promise<unknown> {
    const args = (said.args ?? {}) as { path?: string; root?: string }
    if (said.what === 'pass') {
      const moved = await this.passNow()
      this.sayRows()
      return moved
    }
    if (said.what === 'unsent') {
      const engine = this.current
      if (!engine) return false
      const roots = ownRoots(this.accountId)
      return (await unsentRoots(engine, roots, (id) => this.firstDone(engine, id))).length > 0
    }
    if (said.what === 'holds') return await this.holds(args.path ?? '')
    if (said.what === 'id-at') return await this.idAt(args.path ?? '')
    if (said.what === 'fetch-away') {
      const engine = this.current
      return engine ? await this.fetchAway(engine, args.path ?? '') : false
    }
    if (said.what === 'search-away') {
      return await searchedAway(said.args, (found) => {
        this.say('sync-part', { id: said.id, to: said.from, value: found })
      })
    }
    if (said.what === 'live-meet' && typeof said.from === 'string') {
      return await this.liveMeet(said.from, said.args)
    }
    if (said.what === 'forget') {
      await this.forget(args.root ?? '')
      this.sayRows()
    }
    return null
  }

  private light() {
    return { status: this.status, lastError: this.lastError, lastSyncedAt: this.lastSyncedAt }
  }

  private sayAll() {
    this.sayRows()
    if (this.engine) this.sayAway(this.engine.awayFiles())
    this.say('sync-light', this.light())
  }

  private sayAway(files: readonly AwayFile[]) {
    if (isNative || windows.alone) return
    this.say('sync-away', {
      files: files.map(({ id, path, size, modified }) => ({ id, path, size, modified })),
    })
  }

  private heardAway(said: unknown) {
    if (!Array.isArray(said)) return
    const files = (said as unknown[]).filter(isAway)
    const had = keptAway.all().length
    const back = keptAway.keep(
      files,
      async (path) => (await this.ask('fetch-away', { path })) === true,
    )
    keptAway.answeredBy(new Map(), async (root, query, terms, limit, onFound, excluded) => {
      let told = 0
      const found = await this.ask(
        'search-away',
        { root, query, terms, limit, excluded },
        (one) => {
          told += 1
          onFound(one as Found)
        },
      )
      if (!Array.isArray(found)) return false
      for (const one of found.slice(told)) onFound(one as Found)
      return true
    })
    if (back.length || files.length !== had) this.treeStale()
    for (const path of back) void workspace.arrived(path)
  }

  private sayRows() {
    const engine = this.engine
    if (!engine || windows.alone) return
    const rows: Rows = { spaces: [], notes: [] }
    for (const space of engine.core.spaces.values()) {
      rows.spaces.push({ id: space.id, root: space.row.root, role: space.row.role })
      for (const entry of space.entries.values()) {
        if (entry.seq === null || !entry.local_path || !space.isLive(entry.id)) continue
        rows.notes.push({
          path: joinPath(space.row.root, entry.local_path),
          id: entry.id,
          version: engine.core.numbers.get(entry.id)?.seq ?? 0,
          hash: entry.written_hash ?? '',
        })
      }
    }
    this.say('sync-rows', { rows })
  }

  joinedOf(note: NoteDoc): { text(): string; put(to: string): void } | null {
    const engine = this.engine
    const entry = note.path === null ? null : engine?.entryAt(note.path)
    if (!engine || !entry || engine.core.isHeld(entry.id)) return null
    if (![...this.bound.values()].some((one) => one.id === entry.id && !one.joining)) return null
    const doc = engine.core.docs.get(entry.id)
    if (!doc?.live || !engine.core.pinned.has(entry.id)) return null
    return {
      text: () => doc.text(),
      put: (to) => doc.write((live) => turn('words', live, doc.text(), to, MINE)),
    }
  }

  private followOpen(): () => void {
    return $effect.root(() => {
      $effect(() => {
        const open = workspace.openNotes
        untrack(() => this.rebind(open))
      })
    })
  }

  private followMirrored(): () => void {
    return $effect.root(() => {
      $effect(() => {
        const open = workspace.openNotes
        const seen = this.seenAt
        const surfaces = rooms.surfaces
        untrack(() => {
          if (!this.engine)
            this.mirrors.follow(open, (path) => seen.get(pathKey(path))?.id ?? null, surfaces)
        })
      })
    })
  }

  livesWith(note: NoteDoc, from: string): boolean {
    const engine = this.engine
    if (!engine) return this.mirrors.joins(note.key)
    const id = note.path === null ? null : engine.entryAt(note.path)?.id
    return !!id && this.relay.joined(from, id)
  }

  private liveOf(engine: Engine, id: string): Y.Doc | null {
    return engine.core.pinned.has(id) ? (engine.core.docs.get(id)?.live ?? null) : null
  }

  private async liveMeet(from: string, args: unknown): Promise<unknown> {
    const engine = this.current
    const { id, mine, plane } = (args ?? {}) as { id?: unknown; mine?: unknown; plane?: unknown }
    if (!engine || typeof id !== 'string') return null
    const shape = shapeOf(engine.core.entry(id)?.kind ?? '')
    if (shape !== (plane === true ? 'plane' : 'words')) return null
    if (shape === 'words' && typeof mine !== 'string') return null
    if (this.relay.meeting(from, id)) this.rebind()
    await this.binding
    const doc = engine.core.docs.get(id)
    if (this.current !== engine || !doc?.live || !engine.core.pinned.has(id)) return null
    if (typeof mine === 'string' && !(await meetWords(engine, id, doc, mine))) return null
    this.relay.follow((one) => this.liveOf(engine, one))
    const live = this.liveOf(engine, id)
    const gen = this.relay.genOf(id)
    return gen === null || !live ? null : { gen, whole: Y.encodeStateAsUpdate(live) }
  }

  private async relayHold(
    engine: Engine,
    id: string,
    holds: () => boolean,
    again: () => void,
  ): Promise<(() => void) | null> {
    const doc = await engine.hold(id)
    if (!doc?.live || !holds()) {
      if (doc) await engine.letGo(id)
      return null
    }
    const replaced = () => again()
    doc.replaced = replaced
    return () => {
      if (doc.replaced === replaced) doc.replaced = null
      void engine.letGo(id)
    }
  }

  private rebind(open = workspace.openNotes) {
    this.binding = this.binding.then(() => this.bindNow(open)).catch(() => undefined)
  }

  private async bindNow(open: typeof workspace.openNotes) {
    const engine = this.current
    if (!engine) return
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away within this call
    const wanted = new Map<string, { id: string; on: On; arrivals: () => number }>()
    for (const one of open) {
      if (!one.path) continue
      const note = one.note
      const surface = rooms.planes.get(one.key)
      const entry = engine.entryAt(one.path)
      const joins = entry && joinsAs(note.kind, entry.kind)
      if (entry && engine.core.hasDoc(entry.id) && joins === null)
        this.mismatched(one.key, one.path)
      const on: On | null =
        joins === 'views' ? { note } : joins === 'surface' && surface ? { surface } : null
      if (on && entry && engine.core.hasDoc(entry.id))
        wanted.set(one.key, { id: entry.id, on, arrivals: () => note.arrivals })
    }
    const own = new Set([...wanted.values()].map((one) => one.id))
    for (const id of this.relay.ids()) {
      if (!own.has(id) && engine.core.hasDoc(id) && relayable(engine.core.entry(id)?.kind))
        wanted.set(`${RELAY}${id}`, { id, on: { relay: true }, arrivals: () => 0 })
    }

    for (const [key, one] of this.bound) {
      if (wanted.get(key)?.id === one.id) continue
      uncarry(key)
      this.carried.delete(key)
      one.part()
      this.bound.delete(key)
    }

    for (const [key, one] of wanted) {
      if (this.bound.has(key)) {
        if (!this.carried.has(key)) this.enter(engine, key, one.id, one.on)
        continue
      }
      const arrivals = one.arrivals()
      const holds = () => one.arrivals() === arrivals && this.bound.get(key)?.id === one.id
      this.bound.set(key, { id: one.id, part: () => undefined, joining: true })
      const again = () => {
        uncarry(key)
        this.carried.delete(key)
        this.enter(engine, key, one.id, one.on)
        this.relay.follow((id) => this.liveOf(engine, id))
      }
      const joined =
        'relay' in one.on
          ? await this.relayHold(engine, one.id, holds, again)
          : 'note' in one.on
            ? await attach(engine, one.id, one.on.note, holds, again)
            : await attachPlane(engine, one.id, one.on.surface, holds, again)
      const part = typeof joined === 'function' ? joined : (joined?.part ?? null)
      if (!part || this.bound.get(key)?.id !== one.id) {
        part?.()
        if (this.bound.get(key)?.id === one.id) this.bound.delete(key)
        continue
      }
      this.bound.set(key, { id: one.id, part, plane: typeof joined === 'function' ? null : joined })
      this.enter(engine, key, one.id, one.on)
    }
    this.relay.roomsHeld(
      new Set([...this.bound].flatMap(([key, one]) => (this.carried.has(key) ? [one.id] : []))),
    )
    this.relay.follow((id) => this.liveOf(engine, id))
  }

  private readonly told = new Set<string>()

  private mismatched(key: string, path: string) {
    if (this.told.has(key)) return
    this.told.add(key)
    log('warn', `sync2: ${path} is open as another kind than it syncs as`)
    void unsyncedToast(path.split(/[\\/]/).pop() ?? path)
  }

  private readonly carried = new Set<string>()

  private enter(engine: Engine, key: string, id: string, on: On) {
    const core = engine.core
    const doc = core.docs.get(id)
    const entry = core.entry(id)
    const space = core.spaceOf(id)
    if (!doc?.live || entry?.seq == null || !space || core.isHeld(id)) return
    if (doc.epoch < (core.epochs.get(id) ?? doc.epoch) || !account.token) return

    this.carried.add(key)
    const room = carry(key, {
      noteId: id,
      on,
      gone: () => {
        this.carried.delete(key)
        this.kick(space.id)
      },
      carrying: {
        doc: doc.live,
        device: core.device,
        pending: () => doc.hasPending,
        confirmedSv: () => doc.confirmedSv(),
        met: async (update) => {
          const met = await engine.meet(id, Y.convertUpdateFormatV1ToV2(update))
          if (met === 'hold') {
            queueMicrotask(() => {
              uncarry(key)
              this.carried.delete(key)
            })
          }
          return met
        },
        acked: (seq, sv) => void engine.acked(id, seq, sv),
        epoch: (epoch) => {
          core.epochs.set(id, epoch)
          this.kick(space.id)
        },
        live: (on) => {
          if (on) core.carried.add(id)
          else core.carried.delete(id)
        },
      },
    })
    void room.then((entered) => {
      const plane = this.bound.get(key)?.plane
      if (plane && entered?.hand) plane.hand = entered.hand.bind(entered)
      if (entered?.awareness && this.current === engine) {
        this.relay.roomCame(id, entered.awareness)
        this.relay.follow((one) => this.liveOf(engine, one))
      }
    })
  }
}

interface Rows {
  spaces: { id: string; root: string; role: string | null }[]
  notes: { path: string; id: string; version: number; hash: string }[]
}

function spaceRooted<T extends { row: { root: string } }>(
  spaces: Iterable<T>,
  root: string | null | undefined,
): T | undefined {
  for (const space of spaces) if (samePath(space.row.root, root)) return space
  return undefined
}

function withoutKey(op: FileOp): FileOp {
  if (op.op !== 'created') return op
  const said = { ...op }
  delete said.key
  return said
}

function signedIn(): boolean {
  return account.user !== null
}

type On = { note: NoteDoc } | { surface: PlaneSurface } | { relay: true }

const RELAY = 'relay:'

function relayable(kind: string | undefined): boolean {
  const shape = shapeOf(kind ?? '')
  return shape === 'words' || shape === 'plane'
}

function unreachable(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 429 || error.status >= 500
  return error instanceof TypeError
}

export type IdAt = { id: string; own: boolean } | { none: 'not-running' | 'outside' | 'untaken' }

export function idIn(engine: Engine, path: string, paired: boolean): IdAt {
  const placed = engine.placed(path)
  if (!placed) return { none: paired ? 'outside' : 'not-running' }
  const entry = engine.entryAt(path)
  if (!entry) return { none: 'untaken' }
  const role = placed.space.row.role
  return { id: entry.id, own: role === null || role === 'owner' }
}

function isIdAt(value: unknown): value is IdAt {
  if (!isRecord(value)) return false
  if (typeof value.id === 'string') return typeof value.own === 'boolean'
  return value.none === 'not-running' || value.none === 'outside' || value.none === 'untaken'
}

export const runner = new Runner()

owesLast(() => runner.flushing())
owesAtTheEnd(() => runner.parting())

const SENDING_ROUNDS = 4

const SETTLING = 1_500

async function searchedAway(args: unknown, part: (found: Found) => void): Promise<Found[] | null> {
  const asked = (args ?? {}) as {
    root?: string
    query?: Query
    terms?: string[]
    limit?: number
    excluded?: string[]
  }
  if (!asked.query || typeof asked.root !== 'string') return []
  const found: Found[] = []
  const whole = await keptAway.search(
    asked.root,
    asked.query,
    asked.terms ?? [],
    asked.limit ?? 0,
    (one) => {
      found.push(one)
      part(one)
    },
    asked.excluded ?? [],
  )
  return whole ? found : null
}

function isAway(
  value: unknown,
): value is { id: string; path: string; size: number; modified: number } {
  if (typeof value !== 'object' || value === null) return false
  const one = value as Record<string, unknown>
  return (
    typeof one.id === 'string' &&
    typeof one.path === 'string' &&
    typeof one.size === 'number' &&
    typeof one.modified === 'number'
  )
}

async function listingOf(token: string, spaceId: string): Promise<V1Listing> {
  const notes: V1Listing['notes'][number][] = []
  let cursor = 0
  for (;;) {
    const page = await api.changes(token, spaceId, cursor)
    notes.push(...page.notes)
    const asked = cursor
    cursor = page.cursor
    if (!page.more || cursor === asked) return { cursor, notes }
  }
}

account.forgetWithSession((keepHere) => {
  const id = runner.accountNow
  if (id) void runner.signedOut(id, keepHere)
})

account.askBeforeLeaving(() => runner.sentBeforeLeaving())

function pageNotes(engine: Engine): Carried[] {
  const out: Carried[] = []
  for (const space of engine.core.spaces.values()) {
    const writes = space.row.role !== 'read'
    for (const entry of space.entries.values()) {
      if (entry.kind !== 'pages' || entry.deleted || entry.seq === null || !entry.local_path)
        continue
      if (!space.isLive(entry.id)) continue
      out.push({
        path: joinPath(space.row.root, entry.local_path),
        id: entry.id,
        writes,
        space: space.id,
      })
    }
  }
  return out
}
