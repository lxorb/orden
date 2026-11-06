import type { Times } from '@orden/sync-core/diverge'
import { Doc } from './docs'
import { holdsDocument, shapeOf, type Shape } from './kinds'
import { SpaceState, type Outboxed } from './places'
import {
  againstOf,
  goneKey,
  goneOf,
  keepingOf,
  keepKey,
  numbersKey,
  numbersOf,
  numbersRow,
  orderingOf,
  orderingRow,
  orderKey,
  outgoingBytes,
  outgoingOf,
  wantKey,
  wantedOf,
  wantedRow,
  type Against,
  type DocNumbers,
  type Gone,
  type Keeping,
  type Ordering,
  type Outgoing,
  type Wanted,
} from './records'
import {
  clear,
  get,
  put,
  remove,
  scan,
  type Change,
  type EntryRow,
  type HeldRow,
  type SyncStore,
} from './store'
import type { World } from './world'

const CLIENTS = 'clients'

export interface Classification {
  id: string
  base: string
  local: string
  remote: string
  times: Times
  merged?: string
  held: boolean
}

export interface Holding {
  row: HeldRow
  against: Against
}

export interface CoreEvents {
  resurrected: (event: { id: string; name: string; device: string }) => void
  held: () => void
  unsynced: (event: { id: string; name: string }) => void
  file: (event: { id: string; text: string }) => void
}

export class Core {
  readonly spaces = new Map<string, SpaceState>()
  readonly numbers = new Map<string, DocNumbers>()
  private readonly generations = new Map<string, number>()
  private generation = 0
  readonly docs = new Map<string, Doc>()
  readonly pinned = new Set<string>()
  readonly held = new Map<string, Holding>()
  readonly wants = new Map<string, Map<string, Wanted>>()
  readonly by = new Map<string, string>()
  readonly carried = new Set<string>()
  readonly asked = new Set<string>()
  crowded = false
  readonly epochs = new Map<string, number>()
  readonly classified: Classification[] = []
  readonly touched = new Set<string>()
  readonly stampWaiting = new Map<string, { mtime: number; size: number }>()
  readonly unreadFor = new Map<string, number>()
  readonly refusedBytes = new Map<string, { at: number; hash: string; full: boolean }>()
  readonly events: Partial<CoreEvents> = {}
  readonly inHand = new Map<string, number>()
  readonly handPaths: string[] = []
  readonly unsyncedKept = new Set<string>()
  readonly unsyncedTold = new Set<string>()
  readonly unwrittenFor = new Map<string, number>()
  life = 0
  private writing: Promise<unknown> = Promise.resolve()
  private refused: Change[] = []
  private counter = 0
  private lastMade = 0

  private constructor(
    readonly world: World,
    readonly store: SyncStore,
  ) {}

  get device(): string {
    return this.store.opened.device
  }

  static async open(world: World, store: SyncStore): Promise<Core> {
    const core = new Core(world, store)
    const [spaces, entries, outbox, meta, held] = await store.read([
      scan('spaces'),
      scan('entries'),
      scan('outbox'),
      scan('meta'),
      scan('held'),
    ])

    const orderings = new Map<string, Ordering>()
    const gones = new Map<string, Gone>()
    const keepings = new Map<string, Keeping>()
    for (const row of meta) {
      const keeping = keepingOf(row)
      if (keeping) keepings.set(keeping.space, keeping.keeping)
      const ordering = orderingOf(row)
      if (ordering) orderings.set(ordering.space, ordering.ordering)
      const gone = goneOf(row)
      if (gone) gones.set(gone.space, gone.gone)
      const read = numbersOf(row)
      if (read) core.numbers.set(read.id, read.numbers)
      if (row.key.startsWith(GEN)) {
        core.generations.set(row.key.slice(GEN.length), Number(row.value) || 0)
      }
      if (row.key === CLIENTS) core.generation = Number(row.value) || 0
      if (row.key === COUNTER) core.counter = Number(row.value) || 0
      const wanted = wantedOf(row)
      if (wanted) core.wants.set(wanted.space, wanted.wanted)
    }
    if (!store.opened.wasClean) {
      core.generation += 1
      await core.commit([put('meta', { key: CLIENTS, value: core.generation })])
    }

    for (const space of spaces) {
      const mine = entries.filter((entry) => entry.space_id === space.space_id)
      const waiting: Outboxed[] = []
      for (const row of outbox) {
        core.lastMade = Math.max(core.lastMade, row.made_at)
        if (row.space_id !== space.space_id) continue
        const record = outgoingOf(row.op)
        if (record) waiting.push({ row, record })
      }
      const state = new SpaceState(
        space,
        mine,
        waiting,
        core.device,
        world,
        orderings.get(space.space_id),
      )
      state.gone = gones.get(space.space_id) ?? state.gone
      state.keeping = keepings.get(space.space_id) ?? state.keeping
      core.spaces.set(space.space_id, state)
    }

    for (const row of held) {
      const against = againstOf(row.remote)
      if (against) core.held.set(row.id, { row, against })
    }
    return core
  }

  commit(changes: readonly Change[]): Promise<void> {
    if (!changes.length && !this.refused.length) return this.writing.then(() => undefined)
    const next = this.writing.then(async () => {
      if (this.clean) {
        await this.store.cleanExit(false)
        this.clean = false
      }
      const batch = [...this.refused, ...changes]
      this.refused = []
      try {
        await this.store.write(batch)
      } catch (error) {
        this.refused = batch
        throw error
      }
    })
    this.writing = next.catch(() => undefined)
    return next
  }

  private clean = false

  endedCleanly(): Promise<void> {
    const next = this.writing.then(async () => {
      await this.store.cleanExit(true)
      this.clean = true
    })
    this.writing = next.catch(() => undefined)
    return next
  }

  nextId(prefix: string): string {
    this.counter += 1
    const random = Math.floor(this.world.random() * 2 ** 32).toString(36)
    return `${this.device}.${prefix}${this.counter.toString(36)}.${random}`
  }

  counterRow(): Change {
    return put('meta', { key: COUNTER, value: this.counter })
  }

  freshClient(): number {
    return (Math.floor(this.world.random() * 0xffffffff) >>> 0) + 1
  }

  addSpace(spaceId: string, root: string, role: string | null): Change[] {
    const row = { space_id: spaceId, root, cursor: 0, role, store: null }
    this.spaces.set(spaceId, new SpaceState(row, [], [], this.device, this.world))
    return [put('spaces', row)]
  }

  forgetSpace(spaceId: string): Change[] {
    const space = this.spaces.get(spaceId)
    if (!space) return []
    const changes: Change[] = []
    for (const entry of space.entries.values()) {
      changes.push(...this.letGoChanges(entry.id))
      if (this.hasDoc(entry.id)) changes.push(...this.forgetChanges(entry.id))
    }
    this.spaces.delete(spaceId)
    this.wants.delete(spaceId)
    changes.push(
      clear('entries', spaceId),
      clear('outbox', spaceId),
      remove('spaces', spaceId),
      remove('meta', wantKey(spaceId)),
      remove('meta', orderKey(spaceId)),
      remove('meta', goneKey(spaceId)),
      remove('meta', keepKey(spaceId)),
    )
    return changes
  }

  rootMoved(spaceId: string, root: string): Change[] {
    const space = this.spaces.get(spaceId)
    if (!space) return []
    space.row = { ...space.row, root }
    return [put('spaces', { ...space.row })]
  }

  spaceOf(id: string): SpaceState | null {
    for (const space of this.spaces.values()) if (space.entries.has(id)) return space
    return null
  }

  entry(id: string): EntryRow | null {
    return this.spaceOf(id)?.entries.get(id) ?? null
  }

  shapeOfEntry(id: string): Shape | null {
    const entry = this.entry(id)
    return entry ? shapeOf(entry.kind) : null
  }

  entryChanges(rows: Iterable<EntryRow>): Change[] {
    return [...rows].map((row) => put('entries', { ...row }))
  }

  reorders = 0

  orderChanges(space: SpaceState): Change[] {
    if (!space.repositioned) return []
    space.repositioned = false
    this.reorders += 1
    return [put('meta', orderingRow(space.id, space.ordering))]
  }

  wanted(space: string): Map<string, Wanted> {
    let wanted = this.wants.get(space)
    if (!wanted) {
      wanted = new Map()
      this.wants.set(space, wanted)
    }
    return wanted
  }

  wantChange(space: string): Change {
    return put('meta', wantedRow(space, this.wanted(space)))
  }

  hasDoc(id: string): boolean {
    return this.docs.has(id) || this.numbers.has(id)
  }

  async doc(id: string): Promise<Doc | null> {
    const held = this.docs.get(id)
    if (held) return held
    const numbers = this.numbers.get(id)
    const shape = this.shapeOfEntry(id) ?? 'words'
    if (!numbers) return null
    const [row] = await this.store.read([get('docs', id)])
    const again = this.docs.get(id)
    if (again) return again
    if (!row) return null
    const doc = Doc.fromRow(row, numbers, shape, () => this.world.now())
    this.adopt(doc)
    return doc
  }

  made(id: string, shape: Shape, epoch: number, confirmed?: Uint8Array, seq = 0): Doc {
    const doc = Doc.fresh(
      id,
      shape,
      epoch,
      this.freshClient(),
      () => this.world.now(),
      confirmed,
      seq,
    )
    this.generations.set(id, this.generation)
    this.adopt(doc)
    return doc
  }

  private adopt(doc: Doc) {
    this.docs.set(doc.id, doc)
    this.numbers.set(doc.id, doc.numbers())
    if ((this.generations.get(doc.id) ?? 0) < this.generation) {
      doc.rotate(this.freshClient())
      this.generations.set(doc.id, this.generation)
    }
  }

  docChanges(doc: Doc): Change[] {
    doc.dirty = false
    this.numbers.set(doc.id, doc.numbers())
    return [
      put('docs', doc.row()),
      put('meta', numbersRow(doc.id, doc.numbers())),
      put('meta', { key: `${GEN}${doc.id}`, value: this.generations.get(doc.id) ?? 0 }),
    ]
  }

  dirtyChanges(): Change[] {
    const out: Change[] = []
    for (const doc of this.docs.values()) if (doc.dirty) out.push(...this.docChanges(doc))
    return out
  }

  forgetChanges(id: string): Change[] {
    this.docs.get(id)?.close()
    this.docs.delete(id)
    this.numbers.delete(id)
    this.generations.delete(id)
    this.pinned.delete(id)
    return [
      remove('docs', id),
      remove('written', id),
      remove('meta', numbersKey(id)),
      remove('meta', `${GEN}${id}`),
    ]
  }

  hasPending(id: string): boolean {
    const doc = this.docs.get(id)
    if (doc) return doc.hasPending
    return this.numbers.get(id)?.pending ?? false
  }

  private busy = 0

  async use<T>(work: () => Promise<T>): Promise<T> {
    this.busy += 1
    try {
      return await work()
    } finally {
      this.busy -= 1
      if (!this.busy) this.release()
    }
  }

  current(doc: Doc): boolean {
    return this.docs.get(doc.id) === doc
  }

  private release() {
    for (const [id, doc] of this.docs) {
      if (this.pinned.has(id) || doc.dirty || doc.unsaved.length) continue
      doc.close()
      this.docs.delete(id)
    }
  }

  outgoing(space: SpaceState, record: Outgoing, seen: number): { one: Outboxed; change: Change } {
    this.lastMade = Math.max(this.world.now(), this.lastMade + 1)
    const row = {
      op_id: record.t === 'op' ? record.op.op : this.nextId(record.t),
      space_id: space.id,
      op: outgoingBytes(record),
      seen,
      made_at: this.lastMade,
    }
    const one: Outboxed = { row, record }
    return { one, change: put('outbox', row) }
  }

  holdChanges(holding: Holding): Change[] {
    this.held.set(holding.row.id, holding)
    this.events.held?.()
    return [put('held', holding.row)]
  }

  letGoChanges(id: string): Change[] {
    if (!this.held.delete(id)) return []
    this.events.held?.()
    return [remove('held', id)]
  }

  isHeld(id: string): boolean {
    return this.held.has(id)
  }

  static isDocument(entry: EntryRow): boolean {
    return holdsDocument(entry.kind)
  }
}

const GEN = 'gen:'
const COUNTER = 'counter'
