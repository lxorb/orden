import { idle } from '../breathe'
import { type Camera, clampScale, framingBox, turnOf } from '../camera'
import { owesWords } from '../parting'
import {
  type Canvas,
  canvasRuns,
  emptyCanvas,
  merged,
  printStrokes,
  readCanvas,
  stamped,
  takeParsed,
} from './format'
import { changesBetween, type Written, written } from './written'
import { idSet, pickedBox } from './edits'
import { type KeptView, viewKept, viewOf } from './place'
import { bounds } from './geometry'
import { strokeBox } from './ink'
import { afterQuiet } from '../timing'
import { CanvasHistory } from './history'
import type { Hand, PlaneSurface, Reachable, SharedPlane } from './shared'
import { flushCardEdits } from './writing'
import type { NoteDoc, Tab } from '../workspace/documents.svelte'

const PADDING = 48

const WRITE_DELAY = 1_200

const PRINTED_AT_ONCE = 10_000

export class CanvasStore implements PlaneSurface {
  canvas = $state.raw<Canvas>(emptyCanvas())

  picked = $state.raw<string[]>([])
  readonly pickedSet = $derived(idSet(this.picked))

  #editing = $state<string | null>(null)
  get editing(): string | null {
    return this.#editing
  }

  set editing(id: string | null) {
    if (this.#editing !== null && id !== this.#editing) flushCardEdits()
    this.#editing = id
  }

  shared = $state.raw<SharedPlane | null>(null)

  hands = $state.raw<readonly Hand[]>([])

  private reachable = $state.raw<Reachable>({ undo: false, redo: false })

  private local = $state.raw<Reachable>({ undo: false, redo: false })

  readOnly = $state(false)

  protected readonly tab: Tab
  private readonly note: NoteDoc
  private readonly history: CanvasHistory
  private at = -1
  private readonly writing = afterQuiet(() => this.commit(), WRITE_DELAY)
  private during: string | null = null
  private wrote: Written | null = null
  private opened: { canvas: Canvas; revision: number } | null = null
  protected readonly restored: KeptView | null

  constructor(tab: Tab) {
    this.tab = tab
    this.note = tab.note
    this.read()
    const left = LEFT.get(tab)
    this.history =
      left?.note === this.note && left.revision === this.at ? left.history : new CanvasHistory()
    this.stackChanged()
    this.restored = tab.camera === undefined ? viewOf(tab.path) : null

    const kept = this.restored
    if (kept) this.tab.camera = { x: kept.x, y: kept.y, scale: kept.scale }

    drawn.add(this.mine)
  }

  private readonly mine = new WeakRef(this)

  static drawing(note: NoteDoc, tabs: readonly Tab[]): CanvasStore | null {
    for (const held of drawn) {
      const store = held.deref()
      if (store?.note === note && tabs.includes(store.tab)) return store
    }

    return null
  }

  protected parse(text: string): Canvas {
    return takeParsed(text) ?? readCanvas(text)
  }

  protected runs(canvas: Canvas): string[][] {
    return canvasRuns(canvas)
  }

  get path(): string | null {
    return this.note.path
  }

  get camera(): Camera {
    return this.tab.camera ?? { x: 0, y: 0, scale: 1 }
  }

  set camera(next: Camera) {
    this.tab.camera = { ...next, scale: clampScale(next.scale) }
  }

  protected get keptView(): KeptView {
    return this.camera
  }

  get framed(): boolean {
    return this.tab.camera !== undefined
  }

  get canUndo(): boolean {
    return this.shared ? this.reachable.undo : this.local.undo
  }

  get canRedo(): boolean {
    return this.shared ? this.reachable.redo : this.local.redo
  }

  get box() {
    return pickedBox(this.canvas, this.picked)
  }

  edit(next: Canvas, run?: string) {
    if (next === this.canvas || this.readOnly) return

    const before = this.canvas
    const after = stamped(before, next, Date.now())
    this.canvas = after

    const carrying = run !== undefined && run === this.during
    this.during = run ?? null

    if (this.shared) this.shared.push(before, after)
    else if (!carrying) {
      this.history.record(before)
      this.stackChanged()
    }

    this.soon()
  }

  relinked(change: (canvas: Canvas) => Canvas): boolean {
    if (this.readOnly) return false
    this.follow()
    const next = change(this.canvas)
    if (next === this.canvas) return false

    this.edit(next)
    this.writing.flush()
    return true
  }

  takeBack(run: string): boolean {
    if (this.readOnly || this.during !== run) return false
    this.during = null
    if (this.shared) return this.shared.undo()

    const before = this.history.drop()
    if (!before) return false
    this.stackChanged()

    this.canvas = stamped(this.canvas, before, Date.now())
    this.keepPicked()
    this.soon()
    return true
  }

  undo() {
    if (this.shared) {
      this.shared.undo()
      return
    }

    const before = this.history.undo(this.canvas)
    if (!before) return
    this.stackChanged()

    this.canvas = stamped(this.canvas, before, Date.now())
    this.keepPicked()
    this.soon()
  }

  redo() {
    if (this.shared) {
      this.shared.redo()
      return
    }

    const after = this.history.redo(this.canvas)
    if (!after) return
    this.stackChanged()

    this.canvas = stamped(this.canvas, after, Date.now())
    this.keepPicked()
    this.soon()
  }

  arrived(canvas: Canvas) {
    this.canvas = {
      ...canvas,
      icon: this.canvas.icon ?? null,
      iconColor: this.canvas.iconColor ?? null,
    }
    this.keepPicked()
    this.soon()
  }

  private soon() {
    this.writing()
  }

  handsAre(hands: readonly Hand[]) {
    this.hands = hands
  }

  historyIs(reachable: Reachable) {
    this.reachable = reachable
  }

  private stackChanged() {
    this.local = { undo: this.history.canUndo, redo: this.history.canRedo }
  }

  gone() {
    this.part()
    drawn.delete(this.mine)
  }

  part() {
    flushCardEdits()
    this.writing.flush()
    LEFT.set(this.tab, { note: this.note, revision: this.at, history: this.history })

    if (this.framed) viewKept(this.tab.path, this.keptView)
  }

  follow(): boolean {
    if (this.note.revision === this.at) return false

    const arrived = this.parse(this.note.text)

    if (this.note.restoredAt === this.note.revision) {
      this.at = this.note.revision
      this.edit(arrived)
      this.keepPicked()
      return true
    }

    const ours = this.canvas
    const mine = this.shared !== null || this.history.canUndo || this.note.dirty

    this.at = this.note.revision
    this.history.clear()
    this.stackChanged()

    if (!mine) {
      this.canvas = arrived
      this.keepPicked()
      this.opened = { canvas: arrived, revision: this.at }
      void this.warm()
      return true
    }

    const together: Canvas = {
      ...merged(ours, arrived),
      icon: arrived.icon ?? null,
      iconColor: arrived.iconColor ?? null,
      ...(arrived.extras ? { extras: arrived.extras } : {}),
    }
    if (!arrived.extras) delete together.extras
    this.canvas = together
    this.keepPicked()
    this.shared?.push(ours, together)

    this.commit()
    return true
  }

  protected read() {
    this.canvas = this.parse(this.note.text)
    this.at = this.note.revision
    this.keepPicked()
    this.opened = { canvas: this.canvas, revision: this.at }
    void this.warm()
  }

  private async warm() {
    const ink = this.canvas.ink

    let from = 0
    while (from < ink.length) {
      await idle()
      let points = 0
      let to = from
      while (to < ink.length && points < PRINTED_AT_ONCE) {
        points += ink[to]?.points.length ?? 0
        to++
      }
      printStrokes(ink.slice(from, to))
      from = to
    }

    await idle()
    if (this.wrote?.text !== this.note.text) this.wrote = this.asRead() ?? this.wrote
  }

  private asRead(): Written | null {
    const opened = this.opened
    if (opened?.revision !== this.note.revision) return null

    const read = written(this.runs(opened.canvas))
    return read.text === this.note.text ? read : null
  }

  protected commit() {
    this.writing.cancel()

    const next = written(this.runs(this.canvas))
    const text = next.text
    const last = this.wrote?.text === this.note.text ? this.wrote : this.asRead()
    this.opened = null
    const changes = last ? changesBetween(last, next.runs) : null
    this.wrote = next

    if (changes && last) {
      if (changes.length) this.note.replace(text, true, { from: last.text, changes })
    } else if (text !== this.note.text) {
      this.note.replace(text)
    }
    this.at = this.note.revision
  }

  private keepPicked() {
    if (!this.picked.length && this.editing === null) return
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read within this call and thrown away; nothing renders from it
    const held = new Set([
      ...this.canvas.nodes.filter((node) => !node.locked).map((node) => node.id),
      ...this.canvas.edges.map((edge) => edge.id),
      ...this.canvas.ink.map((stroke) => stroke.id),
    ])

    const kept = this.picked.filter((id) => held.has(id))
    if (kept.length !== this.picked.length) this.picked = kept
    if (this.editing !== null && !held.has(this.editing)) this.editing = null
  }

  isPicked(id: string): boolean {
    return this.pickedSet.has(id)
  }

  pick(id: string, adding = false) {
    if (this.lockedIds().has(id)) return
    if (!adding) {
      if (this.picked.length !== 1 || this.picked[0] !== id) this.picked = [id]
      return
    }

    this.picked = this.isPicked(id) ? this.picked.filter((one) => one !== id) : [...this.picked, id]
  }

  pickAll(ids: readonly string[], adding = false) {
    const wanted = adding ? [...this.picked, ...ids] : ids
    const seen = this.lockedIds()
    const next = wanted.filter((id) => {
      if (seen.has(id)) return false

      seen.add(id)
      return true
    })
    if (next.length === this.picked.length && next.every((id, at) => this.picked[at] === id)) return

    this.picked = next
  }

  private lockedIds(): Set<string> {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read within one call and thrown away; nothing renders from it
    return new Set(this.canvas.nodes.filter((node) => node.locked).map((node) => node.id))
  }

  clearPicked() {
    if (this.picked.length) this.picked = []
  }

  fit(width: number, height: number) {
    const box = bounds([...this.canvas.nodes, ...this.canvas.ink.map(strokeBox)])
    if (box) this.camera = this.framingTurned(box, width, height)
  }

  private framingTurned(
    box: { x: number; y: number; width: number; height: number },
    width: number,
    height: number,
  ): Camera {
    const turn = turnOf(this.camera)
    if (!turn) return framingBox(box, width, height, PADDING)

    const cos = Math.abs(Math.cos(turn))
    const sin = Math.abs(Math.sin(turn))
    const across = box.width * cos + box.height * sin
    const down = box.width * sin + box.height * cos
    const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    const framed = framingBox(
      { x: middle.x - across / 2, y: middle.y - down / 2, width: across, height: down },
      width,
      height,
      PADDING,
    )
    return { ...framed, turn }
  }

  frame(width: number, height: number) {
    const box = this.box
    if (box) this.camera = this.framingTurned(box, width, height)
    else this.fit(width, height)
  }
}

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders from it; see above
const drawn = new Set<WeakRef<CanvasStore>>()

const LEFT = new WeakMap<Tab, { note: NoteDoc; revision: number; history: CanvasHistory }>()

function flushCanvases(): void {
  for (const held of drawn) {
    const store = held.deref()
    if (store) store.part()
    else drawn.delete(held)
  }
}

owesWords(flushCanvases)
