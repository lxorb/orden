import { isCanvasTarget, isPagesTarget } from '@orden/markdown/links'
import { movedTo, nameOf, samePath, within } from '../space-paths'
import type { DocumentStart, NoteDoc, Tab } from './documents.svelte'
import type { FileOp } from './file-ops'
import { TAB_KINDS } from './tab-kinds'

export class OpenDocuments {
  private readonly coming = new Map<string, Promise<NoteDoc | null>>()

  private readonly building = new Set<NoteDoc>()
  private arrangements = 0
  private readonly drafted = new Map<string, NoteDoc>()

  constructor(
    private readonly showing: () => readonly Tab[],
    private readonly begin: (start: DocumentStart) => NoteDoc,
  ) {}

  get all(): NoteDoc[] {
    const seen = new Set<NoteDoc>()
    for (const tab of this.showing()) seen.add(tab.note)

    return [...seen]
  }

  get paths(): Set<string> {
    const out = new Set<string>(this.coming.keys())
    for (const tab of this.showing()) {
      if (tab.note.path !== null) out.add(tab.note.path)
    }
    for (const note of this.building) {
      if (note.path !== null) out.add(note.path)
    }

    return out
  }

  at(path: string): NoteDoc | null {
    for (const tab of this.showing()) {
      if (samePath(tab.note.path, path)) return tab.note
    }

    for (const note of this.building) {
      if (samePath(note.path, path)) return note
    }

    return null
  }

  withKey(key: string): NoteDoc | null {
    for (const tab of this.showing()) {
      if (tab.note.key === key) return tab.note
    }

    for (const note of this.building) {
      if (note.key === key) return note
    }

    return null
  }

  cameBack(share: string, note: NoteDoc) {
    this.drafted.set(share, note)
  }

  cameBackAs(share: string): NoteDoc | null {
    return this.drafted.get(share) ?? null
  }

  make(start: DocumentStart): NoteDoc {
    const held = start.path === null ? null : this.at(start.path)
    if (held?.kind === start.kind) return held

    const note = this.begin(start)
    if (this.arrangements) this.building.add(note)

    return note
  }

  opening(path: string, run: () => Promise<NoteDoc | null>): Promise<NoteDoc | null> {
    const held = this.at(path)
    if (held) return Promise.resolve(held)

    for (const [one, coming] of this.coming) if (samePath(one, path)) return coming

    const opening = this.ran(path, run)
    this.coming.set(path, opening)

    return opening
  }

  private async ran(path: string, run: () => Promise<NoteDoc | null>): Promise<NoteDoc | null> {
    try {
      return await run()
    } finally {
      this.coming.delete(path)
    }
  }

  follow(op: FileOp, close: (id: string) => void) {
    if (op.op === 'created') return

    if (op.op === 'removed') {
      for (const tab of this.showing()) {
        if (tab.path !== null && within(op.path, tab.path) !== null) close(tab.id)
      }
      return
    }

    for (const note of this.all) {
      const to = note.path === null ? null : movedTo(note.path, op.from, op.to)
      if (to === null) continue

      note.path = to
      note.name = nameOf(to)
      this.rekind(note)
    }

    for (const tab of this.showing()) {
      const trail = tab.trail.map((one) => movedTo(one, op.from, op.to) ?? one)
      if (trail.some((one, at) => one !== tab.trail[at])) tab.trail = trail
    }
  }

  private rekind(note: NoteDoc) {
    const path = note.path
    const kind =
      path === null ? null : isPagesTarget(path) ? 'pages' : isCanvasTarget(path) ? 'canvas' : null
    if (path === null || kind === null || kind === note.kind) return
    if (!TAB_KINDS[note.kind].plane) return

    const fresh = this.make({ kind, path, name: note.name, text: note.latest, dirty: note.dirty })
    for (const tab of this.showing()) if (tab.note === note) tab.note = fresh
  }

  async arranging<T>(run: () => Promise<T>): Promise<T> {
    this.arrangements++
    try {
      return await run()
    } finally {
      if (--this.arrangements === 0) {
        this.building.clear()
        this.drafted.clear()
      }
    }
  }
}

interface Held {
  kind: string
  path: string | null
  note: object
}

export function secondWebTabs<T extends Held>(before: readonly T[], next: readonly T[]): [T, T][] {
  const web = next.filter((tab) => tab.kind === 'web' && tab.path !== null)
  if (web.length < 2) return []

  const staying = new Set(web)
  const kept = new Map<object, T>()
  const second: [T, T][] = []

  for (const tab of [...before.filter((one) => staying.has(one)), ...web]) {
    const first = kept.get(tab.note)
    if (!first) kept.set(tab.note, tab)
    else if (first !== tab && !second.some(([one]) => one === tab)) second.push([tab, first])
  }
  return second
}
