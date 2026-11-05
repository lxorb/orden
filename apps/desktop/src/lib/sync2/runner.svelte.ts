/** Sync v2 in the window: the engine (engine.ts) started for the account signed in, and
 *  everything around it that is the app's rather than the engine's.
 *
 *  - **When it runs.** After the first paint, at the launch's `rooms` turn, never
 *    before. A pass over a space when the account's hub pokes about it (about a second
 *    after another device wrote), when something changed here, when the window comes
 *    back, every thirty seconds while visible in case a poke went missing (five minutes
 *    while hidden), and at v1's cadence while the hub cannot be reached
 *    (docs/sync-v2.md 5.12).
 *  - **Which folder is which space**, worked out as v1 does (space-pairing.ts), kept in
 *    the sync store; a space's first pass is migrate.ts.
 *  - **What this device does**, heard as the workspace says it (workspace/file-ops.ts),
 *    and what autosave wrote (`wrote`); what the engine does to the disk is said back
 *    to the workspace the same way, and its own operations are not heard twice.
 *  - **Open notes** joined to their documents (binding.ts), and to their rooms.
 *  - **The light**: syncing, failed, or - when the account cannot be reached - hollow,
 *    never red for being offline.
 *  - **The question** (asking.svelte.ts), handed the held notes. */

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
import { isDesktop, joinPath } from '../tauri'
import { pathKey, samePath } from '../space-paths'
import { oneWriteAt, type Said, windows } from '../windows'
import { waited } from '../timing'
import { appWorld, type Telling } from './app-world'
import type { NoteDoc } from '../workspace/documents.svelte'
import type { PlaneSurface } from '../canvas/shared'
import type { Watched } from './watching'
import { rooms } from '../rooms.svelte'
import * as Y from 'yjs'
import { asking, type Held, type HeldAnswer, unsyncedToast } from './asking.svelte'
import { attach, attachPlane, type PlaneJoin } from './binding'
import { carry, uncarry } from './carry'
import { kindOfName } from './create'
import { MINE } from './docs'
import { Engine } from './engine'
import { type Leadership, leadSync } from './lead'
import { forgetMadeDeviceId, madeDeviceId } from './made-device'
import { Owed, type Owing, takeOwed } from './owed'
import { placesOf } from './placing'
import { type Holding, spend } from '../sync/holding'
import type { Carried } from '../pages/carried'
import { holdsDocument, joinsAs, turn, unixLines } from './kinds'
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

type Light = 'off' | 'idle' | 'syncing' | 'error' | 'offline'

/** How long a window with no engine waits on the one that has it: a pass is what can take
 *  this long, and a window nobody answers in is a window that has gone. */
const ASKS_AT_MOST = 30_000

/** How long signing out in such a window waits for the engine's to let go of the store. */
const SIGN_OUT_WAITS = 10_000

/** How long after a change here the pass that sends it waits, so a burst of saves is one
 *  pass. */
const NUDGE = 2_000

/** The hub's poke is immediate; this catches one that went missing while someone is
 *  looking at the window. Hidden windows keep the quieter five-minute fallback. */
const FALLBACK = 30_000
const HIDDEN_FALLBACK = 5 * 60_000

/** v1's mirrors: what the first pass of each space starts from, never written while v2
 *  runs, and written from the store only when the account goes back to v1 or this device
 *  signs out. */
const MIRRORS = 'nib:mirrors'

/** The meta row that says a space's first pass is done. */
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

/** v1's record of a space with what a pass of its left half done settled first: a
 *  note waiting aside from a swap, which the first pass would read as deleted here.
 *  v1's pass is fetched only for a record that has one; see `asidesBack`. */
async function wholeV1(root: string, v1: V1Space | null): Promise<V1Space | null> {
  const waiting = (path: string) => (path.split('/').pop() ?? '').startsWith('.nib-moving-')
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
  /** The held notes, as the question reads them: reactive, where the engine's list is
   *  not. */
  heldNotes = $state.raw<readonly Held[]>([])

  /** The engine running, the account's or the one kept signed out. */
  private current: Engine | null = null

  /** The account's engine, while one runs: what everything that asks the account about
   *  an entry reads ids off. The one kept signed out is nobody's to ask about. */
  get engine(): Engine | null {
    return this.local ? null : this.current
  }
  private accountId: string | null = null

  /** Whose store is open now. */
  get accountNow(): string | null {
    return this.accountId
  }
  private stops: (() => void)[] = []
  private due = new Set<string>()
  /** The spaces whose last pass heard the account had no room for a file. */
  private readonly full = new Set<string>()
  private passing_: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private quiet = 0
  private reconciledAt = 0
  /** Operations the engine made on the disk, which the workspace says back: not heard
   *  as this person's. */
  private readonly own = new Set<string>()
  /** Spaces whose first pass is done. */
  private readonly firsts = new Set<string>()
  /** Open notes joined to their documents, by document key. */
  private readonly bound = new Map<
    string,
    { id: string; part: () => void; plane?: PlaneJoin | null; joining?: boolean }
  >()
  private binding = Promise.resolve()
  /** The space folders' watch, on the desktop; see watching.ts. */
  private watched: Watched | null = null

  /** Whether the engine running is the one for the spaces used signed out (local.ts). */
  private local = false

  /** Whatever opens or closes a store, one after another: the crate keeps one store
   *  open at a time and closes whichever that is, so an engine starting while another
   *  let go of its own would have its store closed under it. */
  private lane: Promise<unknown> = Promise.resolve()

  private inLane<T>(work: () => Promise<T>): Promise<T> {
    const next = this.lane.then(work)
    this.lane = next.catch(() => undefined)
    return next
  }

  /** Starts the engine for the account signed in, once this window is the one that runs
   *  it: one engine per device, whichever window or tab that is (`leadSync`), and after
   *  the one kept signed out has let go. Until then this window speaks to the one that
   *  does; see "The other windows" below. The wait for the lead is outside the lane, so
   *  a stop meanwhile is never queued behind it. */
  async start(): Promise<void> {
    if (this.local) await this.inLane(() => this.carryLocal())
    // A stop on its way for the engine running (it counted an attempt on past the lead's):
    // this start comes after it, not instead of it.
    if (this.current && this.attempt !== this.leadOf) await this.inLane(() => Promise.resolve())
    const user = account.user
    if (!user || this.current || this.giving) return
    // This start's own attempt: a stop or a later start makes it stale, and nothing a stale
    // one does afterwards touches the newer one's lead, store or account.
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
    // Said again, held: a stop's letting go meanwhile may have cleared it.
    this.accountId = user.id
    try {
      const engine = await this.inLane(async () => {
        if (!live()) return null
        await this.carryLocal()
        return this.running(user, live)
      })
      if (engine) await this.tookOver(engine)
      else if (this.lead === lead) {
        // No engine after all: nothing stands on the lead, nor on the store.
        this.letGoLead()
      }
    } catch (error) {
      // No engine, here: whoever waits next may fare better, and nothing is owed to nobody.
      this.letGoLead()
      this.owed.clear()
      throw error
    }
  }

  /** How the wait for the engine is given up. */
  private giving: AbortController | null = null
  /** Which start is the live one: each start and each stop counts one on. */
  private attempt = 0
  /** The start whose lead `lead` is. */
  private leadOf = 0
  /** This window's being the one that runs the engine. */
  private lead: Leadership | null = null

  /** This window's being the one that may open a store at all. The crate keeps one store
   *  for every window of the app and closes whichever it holds, so an engine in one window
   *  - the account's or the one kept signed out - would have its store closed under it by
   *  another's starting or letting go. Whoever runs either engine holds this first, and
   *  holds it from the one kept signed out to the account's and back, so no other window
   *  ever comes between. Account ids are UUIDs, so no account's lead is ever this one. */
  private storeLead: Leadership | null = null
  /** The wait for it, shared by whoever asks meanwhile: the lock is nobody's twice. */
  private storeWait: Promise<Leadership | null> | null = null
  private storeGiving: AbortController | null = null

  /** Waits until this window holds the device's store; null once the wait is given up. */
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

  /** Stops waiting for the device's store; one held is let go with the store, after it. */
  private stopHolding() {
    this.storeGiving?.abort()
    this.storeGiving = null
    this.storeWait = null
  }

  /** What is under way here on the device's store without an engine of its own: a drop,
   *  a walk back, a local start, a device id read. */
  private storeUses = 0

  /** `work`, holding the device's store for it; undefined once the wait is given up. The
   *  store is let go of after, by the one rule (`settleStore`). */
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

  /** The one rule for letting go of the device's store: when nothing in this window is on
   *  it or on its way to it - no engine, no account lead, no start waiting for one, no
   *  other use under way. Kept otherwise, so nothing that stands on it has it go from
   *  under it; let go of then, so another window can read the device id out of it or
   *  start the next engine. */
  private settleStore() {
    if (this.current || this.lead || this.giving || this.storeWait || this.storeUses) return
    this.storeLead?.release()
    this.storeLead = null
  }

  /** The ids the spaces kept signed out had, by each space's root, on their way to the
   *  account's store; see `carryLocal`. */
  private carrying = new Map<string, string>()

  /** Signing in: the engine kept signed out lets go, the ids of everything it kept are
   *  carried over for the account's first pass of each space (`firstPass`), and its
   *  store goes, so a later session signed out starts from the folders as they are
   *  then, never from a tree from before that the disk would be made to agree with.
   *  Never while the account's engine runs: opening the store kept signed out then
   *  would close the account's under it, and there is nothing left to carry anyway.
   *  Only in the window holding the device's store (`storeLead`), which it keeps. */
  private async carryLocal(): Promise<void> {
    if (!this.storeLead) return
    try {
      const engine = this.current
      if (engine && !this.local) return
      if (engine) {
        this.keepCarried(await carriedIds(engine.core.store, isLocal, account.user?.id))
        await this.letGo(true)
      } else {
        // Only the desktop keeps spaces signed out this way; see `startLocal` in sync.svelte.ts.
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

  /** Whose store the ids being carried came from: an account's, signing out, or null
   *  for the one kept signed out. */
  private carriedFrom: string | null = null

  /** The ids carried, into the account's store, for every space whose first pass is
   *  still to come: kept there, so a first pass a relaunch away still finds them. */
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

  /** Opens the account's store and starts its engine, in the lane: answers it, or null
   *  once this session has moved on meanwhile. */
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
    await this.carriedIn(engine)
    engine.held.changed = (notes) => (this.heldNotes = notes)
    this.heldNotes = engine.held.notes

    // The question reads the held notes reactively; the engine's own list is plain.
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
    // The workspace's moves and deletes, said to the engine before the disk has them.
    this.stops.push(workspace.fileOps.doneBy(this.doer))
    // The file list's hand-arranged order, by the places the account keeps (#1068).
    this.stops.push(
      workspace.arranged.placeBy(
        placesOf(engine, (root, folder) => {
          const tree = workspace.tree
          if (!tree || !samePath(tree.path, root)) return null
          return folder
            ? (workspace.entryAt(joinPath(root, folder))?.children ?? null)
            : tree.children
        }),
      ),
    )
    // A canvas's surface arrives after its tab: the planes are joined once it has.
    rooms.drawn = () => this.rebind()
    this.stops.push(() => (rooms.drawn = null))
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

  /** Starts the engine with no account behind it, for the spaces used signed out
   *  (#1068, step 4b; local.ts): every folder, note and file has an id from the start,
   *  and what the file list does is said to the engine by id as it is signed in. Its
   *  store is its own (`LOCAL_STORE`), and nothing in it reaches the network: no hub,
   *  no rooms, no light in the corner. Answers once it runs, or once it will not. */
  async startLocal(): Promise<void> {
    if (account.user) return
    // One window keeps it for all of them: the others wait, and take it when that one goes.
    await this.usingStore(() => this.inLane(() => this.startLocalNow()))
  }

  private async startLocalNow(): Promise<void> {
    if (this.current || account.user) return
    const store = await openSyncStore(LOCAL_STORE)
    const engine = await Engine.start(
      appWorld(() => null, this.telling),
      store,
    )
    // Signed in while the store was opening: the account's engine is next in line.
    if (signedIn()) {
      engine.stop()
      await store.close().catch(() => undefined)
      return
    }
    this.local = true
    this.current = engine
    // The ids the account's store had, signing out, for each space's first pass here;
    // nothing carried the other way, which was for an account.
    const from = this.carriedFrom
    const carried = new Map(this.carrying)
    this.carrying.clear()
    this.carriedFrom = null
    if (from !== null && carried.size) await engine.core.commit(carriedRows(carried, from))
    this.stops.push(workspace.fileOps.doneBy(this.doer))
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

  /** The spaces used signed out let go of, their ids carried (`carryLocal`): what
   *  signing in does, whichever engine the account runs. */
  async dropLocal(): Promise<void> {
    // Only the window holding the device's store forgets it: another window may still be
    // keeping it, and lets go of it first when it hears the same.
    // Asked for a sign-in that may be over by the time the store is this window's: signed
    // out since, the store it takes over is the one to keep, not to carry and forget.
    await this.usingStore(() =>
      this.inLane(() => (account.user ? this.carryLocal() : Promise.resolve())),
    )
  }

  /** This device's id in the account's store (the hub's `deviceId`): the running engine's
   *  here, else read beside the store (`deviceOfSyncStore`), which opens, closes and marks
   *  nothing, so no window's engine has its store closed under it and a clean quit stays
   *  clean. Null before the account has a store on this device. */
  async deviceOf(accountId: string): Promise<string | null> {
    const engine = this.engine
    if (engine && this.accountId === accountId) return engine.core.store.opened.device
    return await deviceOfSyncStore(accountId).catch(() => null)
  }

  /** A held note answered: Keep mine, Keep theirs or Keep both. Answers the copy's path
   *  for the third. */
  async answer(id: string, answer: HeldAnswer): Promise<string | undefined> {
    const engine = this.current
    if (!engine) return undefined
    const copy = await engine.held.answer(id, answer)
    this.nudge()
    // Answered: the note may be carried by its room again.
    this.rebind()
    if (copy) this.treeStale()
    return copy
  }

  /** Lets the engine go: signing out, or the account going back to v1. While signing
   *  out is writing v1's mirrors from the store, it is the one that lets go: syncing is
   *  told to stop in the same moment (the account's session has gone), and a stop that
   *  closed the store under it left the mirrors unwritten and the words typed offline
   *  with nothing saying they were this device's. */
  stop(): Promise<void> {
    return this.leaving ?? this.halt()
  }

  /** Signing out, while it runs. */
  private leaving: Promise<void> | null = null

  private halt(keepLead = false): Promise<void> {
    const at = ++this.attempt
    this.giving?.abort()
    this.giving = null
    this.stopHolding()
    this.owed.clear()
    this.seen = { spaces: [], notes: [] }
    this.seenAt.clear()
    this.noLeader()
    for (const stop of this.hearings.splice(0)) stop()
    return this.inLane(() => this.letGo(keepLead, () => this.attempt !== at))
  }

  /** `overtaken`: a start came after the stop this is for, and what it holds or says is its
   *  own: only the engine before it goes, and a lead from before it. */
  private async letGo(keepLead = false, overtaken: () => boolean = () => false): Promise<void> {
    for (const stop of this.stops.splice(0)) stop()
    for (const key of this.carried) uncarry(key)
    this.carried.clear()
    this.full.clear()
    usage.syncFull(false)
    for (const one of this.bound.values()) one.part()
    this.bound.clear()
    clearTimeout(this.timer)
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
    if (!newer) this.letGoLead()
    else if (this.lead && this.leadOf !== this.attempt) {
      // The lead of the start this stop was for: the newer one waits for it.
      this.lead.release()
      this.lead = null
      this.settleStore()
    }
  }

  /** No longer the window that runs the engine, nor the one that may open a store: said
   *  once its store is closed, so the next window's opens after it. */
  private letGoLead() {
    this.lead?.release()
    this.lead = null
    this.settleStore()
  }

  /** A save: everything typed written down, after autosave's own last writes. */
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

  /** The window going: everything typed written down, and the session marked ended
   *  cleanly, after autosave's own last writes. */
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

  /** The account went back to v1 (docs/sync-v2.md section 11): whatever this device has
   *  pending goes up first, then v1's mirrors are written from the store and the
   *  account's own listing, so v1 meets each note as one it knows, at the version the
   *  account holds, and writes no copy of anything. The store goes once they are written:
   *  v1 moves the files on from here, and a later switch to v2 starts again from v1's
   *  word, as the first switch did.
   *
   *  Answers whether v1 may start. Not while the account cannot be reached: v1 starting
   *  from mirrors older than what v2 did here would delete every note v2 renamed. */
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
      const settling = () => waited(SETTLING)
      if (!(await sentAll(engine, kept, SENDING_ROUNDS, settling))) return false
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
      }
    }
  }

  /** The way back, tried until it is walked, at v1's cadence while the account cannot be
   *  reached. Answers whether v1 may start, false once `alive` says this session ended. */
  async walkBack(alive: () => boolean): Promise<boolean> {
    // One window walks it: an engine for this is an engine like any other, so it opens the
    // account's store only holding the device's, as `start` does (`usingStore`).
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

  /** The spaces v2 kept here: the ones whose first pass is done. */
  private async kept(engine: Engine): Promise<ReadonlySet<string>> {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read once on the way back; nothing renders from it
    const done = new Set<string>()
    for (const id of engine.core.spaces.keys()) {
      if (await this.firstDone(engine, id)) done.add(id)
    }
    return done
  }

  /** v1's mirrors as they stand now: the spaces v2 kept, written from the store, and
   *  every other space as v1 last wrote it. */
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

  /** Signing out: the store goes, as it empties the vault (docs/sync-v2.md section 10),
   *  but first v1's mirrors are written from it. Words typed and not sent yet are on the
   *  disk, and the mirrors say what the account had confirmed under them, so the next
   *  first pass - or v1 - sends them as this device's edits rather than meeting them as
   *  a stranger's. */
  signedOut(accountId: string): Promise<void> {
    this.leaving ??= this.leave(accountId).finally(() => (this.leaving = null))
    return this.leaving
  }

  private async leave(accountId: string): Promise<void> {
    const engine = this.current
    if (engine) {
      try {
        const done = await this.kept(engine)
        const mirrors = done.size ? await this.mirrorsNow(engine, accountId, null, done) : null
        if (mirrors) keepJson(MIRRORS, { account: accountId, seen: true, mirrors })
      } catch (error) {
        log('warn', `sync: signing out kept no mirrors - ${String(error)}`)
      }
      // What every space holds keeps its id signed out too, on the desktop, which keeps
      // spaces signed out (`startLocal`); see `carriedRows` in local.ts.
      if (isDesktop && !this.local) {
        const ids = await carriedIds(engine.core.store, () => true).catch(() => null)
        if (ids) {
          this.carrying.clear()
          this.keepCarried(ids)
          this.carriedFrom = accountId
        }
      }
    }
    // Holding the device's store, this window is the one any engine would be in.
    const led = !!engine || !!this.lead || !!this.storeLead
    await this.halt(true)
    this.firsts.clear()
    if (led) {
      // Held until the store is gone, so no window that has not heard yet opens it meanwhile.
      forgetMadeDeviceId(accountId)
      await forgetSyncStore(accountId).finally(() => this.letGoLead())
      return
    }
    // Another window runs the engine, and it hears this too (workspace/across.ts): the store
    // goes once that window has let go of it, not from under it.
    const giving = new AbortController()
    const late = setTimeout(() => giving.abort(), SIGN_OUT_WAITS)
    const lead = await leadSync(giving.signal, accountId)
    clearTimeout(late)
    forgetMadeDeviceId(accountId)
    await forgetSyncStore(accountId)
      .catch(() => undefined)
      .finally(() => lead?.release())
  }

  // -------------------------------------------------------------------------
  // When to pass

  /** Whether a pass is under way. */
  get passing(): boolean {
    return this.passing_ !== null
  }

  /** Every space passed now, waited for: what automation and a link joining ask for.
   *  Answers whether anything moved. */
  async passNow(): Promise<boolean> {
    if (!this.current) {
      // Nobody to ask: starting, or an engine that would not start. Waiting would not help.
      return this.leaderId ? (await this.ask('pass', {})) === true : false
    }
    const before = this.lastSyncedAt
    this.kick()
    await this.passing_
    return this.lastSyncedAt !== before
  }

  /** A pass soon over one space, or all of them. */
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

  /** Something changed here: a pass in a moment, unless one is sooner. */
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
    // Set by what runs below in its own function, which is more than a read of them can see.
    let offline = false as boolean
    let moved = false as boolean
    try {
      if (this.due.delete('') || Date.now() - this.reconciledAt >= RECONCILE_INTERVAL) {
        // The account out of reach is the hollow light, never the red one: the passes
        // below find the same and stop quietly.
        const reconciling = this.local ? this.pairLocal(engine) : this.reconcile(engine)
        await reconciling.catch((error: unknown) => {
          if (!unreachable(error)) throw error
          offline = true
        })
      }
      // One space's trouble is that space's: the others have their turn, and it is said after.
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
          if (!this.local) this.placesHeard(engine, space.row.root)
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
      // The paper each page note holds goes where the note goes (#551), kept by the
      // note's id rather than as a file of the tree; see pages/carried.ts. Not waited
      // for: a paper is megabytes, and nothing in the pass is behind it.
      void import('../pages/carrying').then(({ carryNow }) =>
        carryNow(
          () => pageNotes(engine),
          (note, failed) => void engine.said(note.space, failed),
        ),
      )
      this.lastSyncedAt = Date.now()
      this.status = offline ? 'offline' : 'idle'
      if (moved) this.sayRows()
    } catch (error) {
      if (this.current !== engine) return
      // The session ended on the account: signed out here too, as every other request
      // signs out.
      if ((error instanceof Refused || error instanceof ApiError) && error.status === 401) {
        void account.signOut()
        return
      }
      log('error', `sync: ${error instanceof Error ? error.message : String(error)}`)
      this.status = 'error'
      this.lastError = error instanceof Error ? error.message : String(error)
    }
  }

  /** How many times the engine's places had changed when the file list last heard. */
  private reorders = -1

  /** A pass over a space is over: its hand-arranged order is brought into line with the
   *  places (`fromPlaces`), and drawn again where they changed. */
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
    for (const space of engine.core.spaces.values()) if (space.row.root === root) return space.id
    return null
  }

  /** Which folder is which space, signed out: every space of the workspace is one kept
   *  here, and one that left the workspace is let go of. A space's folder moved is told
   *  by the file list as it moves (`follow`), so its tree goes with it. */
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

  /** Which folder is which space: v1's rules, with the pairing in the sync store. */
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
        const space = [...core.spaces.values()].find((one) => one.row.root === root)
        if (space) changes.push(...core.forgetSpace(space.id))
      },
      share: (root, shared) => {
        const space = [...core.spaces.values()].find((one) => one.row.root === root)
        if (!space) return
        const role =
          account.spaces.find((one) => one.id === space.id)?.role ?? (shared ? 'write' : 'owner')
        if (space.row.role === role) return
        space.row = { ...space.row, role }
        changes.push(put('spaces', { ...space.row }))
      },
    }
    // The folders v1 had paired, for a store that has paired none of them yet (v1-pairs.ts).
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
  }

  // -------------------------------------------------------------------------
  // This device's own changes

  /** The engine's own operations on the disk, said to the workspace and not heard back. */
  private readonly telling: Telling = {
    holdingWrites: (from, run, stalled) => workspace.holdingWrites(from, run, stalled),
    moved: async (from, to, kind) => {
      this.own.add(`moved:${from}`)
      try {
        await workspace.fileMoved(from, to, kind)
        await workspace.undone.moved(from, to)
      } finally {
        this.own.delete(`moved:${from}`)
      }
    },
    gone: async (path, kind) => {
      this.own.add(`removed:${path}`)
      try {
        await workspace.fileGone(path, kind)
        // Remote deletions update every path-based store above, but unlike a
        // downloaded document they do not call `written`. Refresh the sidebar
        // after the deletion has reached those stores so its row disappears now.
        this.treeStale()
      } finally {
        this.own.delete(`removed:${path}`)
      }
    },
    written: () => {
      this.treeStale()
    },
    // A file the engine wrote is one more write in that file's one line of writes, which
    // the other windows hold the note of; see workspace/across.ts.
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

  /** A move or a delete the workspace is making (`doing` in workspace/file-ops.ts),
   *  said to the engine by the id of what is there before the disk has it, and the
   *  disk's part made inside that (`moving` and `removing` in engine.ts). */
  readonly doer: Doer = async (op, run) => {
    const engine = this.current
    if (!engine || op.kind === 'space' || op.op === 'created') {
      await run()
      return
    }
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
    this.nudge()
  }

  /** A file operation, heard as everything kept by path hears it. Answers what is left to
   *  do, which the operation waits for, so the account hears operations in the order
   *  they were done. */
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
        // A picture or a recording travels as its bytes, which the engine reads itself.
        const text =
          op.kind === 'folder' || !holdsDocument(kindOfName(op.path))
            ? undefined
            : (document?.latest ?? (await engine.core.world.disk.read(op.path)) ?? '')
        // A day's note the append action made starts from nothing, which is what two of
        // them made apart are merged against.
        const mergeable = this.mergeables.delete(op.path) ? '' : undefined
        // A delete put back comes back as the entries it was, where the engine has it.
        if (!(op.back && (await engine.restored(op.path, op.back)))) {
          await engine.created(op.path, op.kind === 'folder', text, mergeable)
        }
        this.rebind()
      } else if (op.op === 'moved') {
        if (op.kind === 'space') {
          const space = [...engine.core.spaces.values()].find((one) => one.row.root === op.from)
          if (space) await engine.core.commit(engine.core.rootMoved(space.id, op.to))
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

  /** Paths of notes about to be made by the append action: made `mergeable`. */
  private readonly mergeables = new Set<string>()

  mergeable(path: string) {
    if (!this.engine && this.accountId) this.say('sync-mergeable', { path })
    this.mergeables.add(path)
  }

  /** Autosave wrote a note: recorded, and what was typed is one more pending update. */
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

  /** The account's id for a space's folder. */
  remoteIdFor(root: string): string | null {
    if (!this.engine) return this.seen.spaces.find((one) => one.root === root)?.id ?? null
    for (const space of this.engine.core.spaces.values()) {
      if (space.row.root === root) return space.id
    }
    return null
  }

  /** The role the sync store kept for the space a folder is, as the account last
   *  said it: what may be done there before the account is asked again. */
  roleKept(root: string): string | null {
    if (!this.engine) return this.seen.spaces.find((one) => one.root === root)?.role ?? null
    for (const space of this.engine.core.spaces.values()) {
      if (space.row.root === root) return space.row.role
    }
    return null
  }

  /** The file on this disk an entry of the account is, by its id: null for one that is
   *  not on this disk, or in no space this device syncs. */
  fileOf(id: string): string | null {
    if (!this.engine) return this.seen.notes.find((one) => one.id === id)?.path ?? null
    for (const space of this.engine.core.spaces.values()) {
      const local = space.entries.get(id)?.local_path
      if (local && space.isLive(id)) return joinPath(space.row.root, local)
    }
    return null
  }

  /** What the account holds for a note on this disk: its id, its version, and the digest
   *  of what Orden last wrote. */
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

  /** Whether the account holds what is at a path on this disk now, so a delete can be
   *  left to it; see `holds` in sync.svelte.ts.
   *
   *  An entry with a number has been handed over once, and that is all it says. A note
   *  with words not acknowledged, or whose file another program wrote since Orden did, is
   *  ahead of the account. A file another program changed (`touched`), one whose bytes
   *  the account names differently from the ones last on this disk, and one held in a
   *  conflict - whose bytes here were never sent (`holdFile` in files.ts) - are too. Each
   *  is read and hashed against what was last written, since the watcher's word on a
   *  change can come a moment after the change. */
  async holds(path: string, how: Holding = {}): Promise<boolean> {
    // Not knowing is the safe answer: a delete then keeps its copy in this device's trash.
    if (!this.engine && this.accountId) return (await this.ask('holds', { path })) === true
    const engine = this.engine
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
    // What is larger than a folder check may still read is not read at all.
    if (!blobs || (how.budget && (entry.size ?? Infinity) > how.budget.left)) return false
    const bytes = await blobs.read(path)
    if (!bytes || !spend(how, bytes.byteLength)) return false
    return (await blobs.hash(bytes)) === entry.written_hash
  }

  /** A space deleted here: its rows go with it. */
  async forget(root: string): Promise<void> {
    if (!this.current && this.accountId) {
      await this.ask('forget', { root })
      return
    }
    const engine = this.current
    const space = [...(engine?.core.spaces.values() ?? [])].find((one) => one.row.root === root)
    if (engine && space) await engine.core.commit(engine.core.forgetSpace(space.id))
  }

  /** A device's name, by its id on the account: the account's list, asked for once by
   *  everyone who wants a name while it is coming, and kept only once it came. A list
   *  that could not be had is asked for again next time, rather than every device being
   *  nameless for the rest of the session. */
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

  // -------------------------------------------------------------------------
  // The other windows
  //
  // One window runs the engine. Each of the others keeps no engine and asks that one: what
  // it did goes over in `owed`, and what the rest of the app asks of the engine in passing
  // (which space a folder is, what the account holds of a note) is answered from what the
  // engine's window last said. An open note in such a window is carried by its file,
  // through the passes and workspace/across.ts, not by a room: the room is that window's.

  /** The account's ids as the engine's window last said them. */
  private seen: Rows = { spaces: [], notes: [] }
  private seenAt = new Map<string, { id: string; version: number; hash: string }>()
  private readonly owed = new Owed((item) => this.say('sync-owed', { item }))
  /** The window that runs the engine, as far as anyone has said. */
  private leaderId: string | null = null
  /** A visible window's pass on the clock, kept by the window that runs them. */
  private beat: ReturnType<typeof setInterval> | undefined

  /** Whether anything this window does has anywhere to go: to an engine on its way, here or
   *  in the window that holds the lock, or to one that is running. */
  private get owedTo(): boolean {
    return !!this.giving || !!this.lead || !!this.leaderId
  }

  /** Said for this account's windows and heard from them alone: two accounts are two
   *  stores, and another's words must never reach this one's. */
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
    // Whoever is looking at this window is why a pass should not wait for that one to be
    // looked at: its clock runs slow while it is hidden, this one keeps it to a visible
    // window's. A window holding a lock is not frozen, so nobody need take over from it.
    this.beat ??= setInterval(() => this.lookedAt(), FALLBACK)
  }

  /** Nobody runs the engine, as far as this window can say, and so nobody will answer. */
  private noLeader() {
    this.leaderId = null
    clearInterval(this.beat)
    this.beat = undefined
    for (const answer of [...this.asked.values()]) answer(null)
  }

  private lookedAt() {
    if (!this.engine && this.leaderId && document.visibilityState !== 'hidden') {
      this.say('sync-kick')
    }
  }
  /** What this window hears while it is signed in, engine or not. */
  private readonly hearings: (() => void)[] = []
  /** Questions asked of the engine's window, by id. */
  private readonly asked = new Map<string, (value: unknown) => void>()
  /** Things owed by others, one at a time, as they were said. */
  private taking: Promise<unknown> = Promise.resolve()

  /** Asks the engine's window. Nobody there, or nobody who answers soon: null. */
  private ask(what: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.leaderId) return Promise.resolve(null)
    return new Promise((resolve) => {
      const id = crypto.randomUUID()
      const timer = setTimeout(() => {
        this.asked.delete(id)
        resolve(null)
      }, ASKS_AT_MOST)
      this.asked.set(id, (value) => {
        clearTimeout(timer)
        this.asked.delete(id)
        resolve(value)
      })
      this.say('sync-ask', { id, what, args })
    })
  }

  /** What a window with no engine listens to. A window that takes the engine goes on
   *  hearing these, and nobody says them to it any more. */
  private hearLeader() {
    if (this.hearings.length) return
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
      }),
      this.hear('sync-took', (said) => {
        if (said.to === windows.me && typeof said.id === 'string') this.owed.done(said.id)
      }),
      this.hear('sync-said', (said) => {
        if (said.to === windows.me && typeof said.id === 'string') {
          this.asked.get(said.id)?.(said.value)
        }
      }),
      this.hear('sync-light', (said) => {
        if (this.engine) return
        this.leaderIs(said.from)
        this.status = said.status as Light
        this.lastError = (said.lastError as string | null) ?? null
        this.lastSyncedAt = (said.lastSyncedAt as number | null) ?? null
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
      }),
    )
    this.say('sync-hello')
  }

  /** This window has the engine now: what it owed runs here, what the others owe comes
   *  here, and they are told, so whatever the last engine's window never answered is said
   *  again. */
  private async tookOver(engine: Engine) {
    this.noLeader()
    this.stops.push(
      this.hear('sync-owed', (said) => {
        const item = said.item as Owing
        this.inTurn(async () => {
          await this.took(engine, item)
          this.say('sync-took', { id: item.id, to: said.from })
        })
      }),
      this.hear('sync-kick', (said) => {
        this.kick(typeof said.space === 'string' ? said.space : undefined)
      }),
      this.hear('sync-mergeable', (said) => {
        if (typeof said.path === 'string') this.mergeables.add(said.path)
      }),
      this.hear('sync-ask', (said) => {
        this.inTurn(async () => {
          this.say('sync-said', {
            id: said.id,
            to: said.from,
            value: await this.answering(said).catch(() => null),
          })
        })
      }),
      this.hear('sync-hello', () => this.sayAll()),
      $effect.root(() => {
        $effect(() => {
          const said = {
            status: this.status,
            lastError: this.lastError,
            lastSyncedAt: this.lastSyncedAt,
          }
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

  private inTurn(run: () => Promise<void>) {
    this.taking = this.taking.then(run).catch((error: unknown) => {
      log('error', `sync: another window's - ${String(error)}`)
    })
  }

  private took(engine: Engine, item: Owing): Promise<void> {
    return takeOwed(engine, item, (op) => this.follow(op)).then(() => this.nudge())
  }

  private async answering(said: Said): Promise<unknown> {
    const args = (said.args ?? {}) as { path?: string; root?: string }
    if (said.what === 'pass') {
      const moved = await this.passNow()
      this.sayRows()
      return moved
    }
    if (said.what === 'holds') return await this.holds(args.path ?? '')
    if (said.what === 'forget') {
      await this.forget(args.root ?? '')
      this.sayRows()
    }
    return null
  }

  private sayAll() {
    this.sayRows()
    this.say('sync-light', {
      status: this.status,
      lastError: this.lastError,
      lastSyncedAt: this.lastSyncedAt,
    })
  }

  /** What the other windows answer with, once there are any. */
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

  /** The document a note on screen here is joined to, for what another window wrote into
   *  it to go in through: the binding then brings it to the note as an arrival. */
  joinedOf(note: NoteDoc): { text(): string; put(to: string): void } | null {
    const engine = this.engine
    const entry = note.path === null ? null : engine?.entryAt(note.path)
    if (!engine || !entry || engine.core.isHeld(entry.id)) return null
    // Not yet where `attach` is still joining: words put in now reach the document and
    // not the note, whose next write would put its older ones over the disk.
    if (![...this.bound.values()].some((one) => one.id === entry.id && !one.joining)) return null
    const doc = engine.core.docs.get(entry.id)
    if (!doc?.live || !engine.core.pinned.has(entry.id)) return null
    return {
      text: () => doc.text(),
      put: (to) => doc.write((live) => turn('words', live, doc.text(), to, MINE)),
    }
  }

  // -------------------------------------------------------------------------
  // Open notes

  /** Joins every open note to its document, and parts the ones that closed. */
  private followOpen(): () => void {
    return $effect.root(() => {
      $effect(() => {
        const open = workspace.openNotes
        untrack(() => this.rebind(open))
      })
    })
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
      // A tab whose name and entry disagree about the shape, after a rename across
      // `.md` and `.canvas`, is left unjoined, and the reader is told once: what is
      // typed there that the entry's kind cannot hold does not sync.
      if (entry && engine.core.hasDoc(entry.id) && joins === null)
        this.mismatched(one.key, one.path)
      const on: On | null =
        joins === 'views' ? { note } : joins === 'surface' && surface ? { surface } : null
      if (on && entry && engine.core.hasDoc(entry.id))
        wanted.set(one.key, { id: entry.id, on, arrivals: () => note.arrivals })
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
      // A document made again under the note - the account's words taken, a new epoch -
      // is a document its room has never met: the room is joined afresh.
      const again = () => {
        uncarry(key)
        this.carried.delete(key)
        this.enter(engine, key, one.id, one.on)
      }
      const joined =
        'note' in one.on
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
  }

  /** Tabs already told that their file syncs as another kind; see `bindNow`. */
  private readonly told = new Set<string>()

  private mismatched(key: string, path: string) {
    if (this.told.has(key)) return
    this.told.add(key)
    log('warn', `sync2: ${path} is open as another kind than it syncs as`)
    void unsyncedToast(path.split(/[\\/]/).pop() ?? path)
  }

  /** Open notes whose documents a room is carrying, by document key. */
  private readonly carried = new Set<string>()

  /** An open note's document, carried live through its room: only one the account
   *  knows, on the epoch the account is on, and not held for the question. */
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
            // Out of the room until the question is answered; the answer joins it again.
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
    // A canvas's pointer goes to the others through the room while there is one.
    void room.then((entered) => {
      const plane = this.bound.get(key)?.plane
      if (plane && entered?.hand) plane.hand = entered.hand.bind(entered)
    })
  }
}

/** What the engine's window says of what the engine holds, for the others to answer from. */
interface Rows {
  spaces: { id: string; root: string; role: string | null }[]
  notes: { path: string; id: string; version: number; hash: string }[]
}

/** A file operation as it goes to another window: a document's key means nothing there. */
function withoutKey(op: FileOp): FileOp {
  if (op.op !== 'created') return op
  const said = { ...op }
  delete said.key
  return said
}

/** Whether somebody is signed in now: read again after every wait. */
function signedIn(): boolean {
  return account.user !== null
}

/** What an open note is joined through: its views, or a canvas's surface. */
type On = { note: NoteDoc } | { surface: PlaneSurface }

/** Whether a request failed for want of the account rather than by its answer: no
 *  network, or the account too busy or failing to say anything (transport.ts reads the
 *  engine's own requests the same way). */
function unreachable(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 429 || error.status >= 500
  return error instanceof TypeError
}

export const runner = new Runner()

owesLast(() => runner.flushing())
owesAtTheEnd(() => runner.parting())

/** How many rounds of passes the way back gives what is pending to go up and be taken. */
const SENDING_ROUNDS = 4

/** How long between them: a room takes what was pushed a moment after the push. */
const SETTLING = 1_500

/** v1's whole listing of a space, deleted notes too, page by page. */
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

// Signing out deletes the account's sync store, as it empties the vault (docs/sync-v2.md
// section 10): what is in it is the account's, and the next account is somebody else.
account.forgetWithSession(() => {
  const id = runner.accountNow
  if (id) void runner.signedOut(id)
})

/** The page notes the account holds of every space this engine keeps, for their papers. */
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
