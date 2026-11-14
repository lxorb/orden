import { lineStarts } from '@orden/scan/search/lines'
import { fold, type SearchNote } from '@orden/scan/search/match'
import type { Warmth } from '@orden/scan/search/warmth'
import { breathe } from '../breathe'
import { hiddenUnder, isMarkdown, normalise, under } from '../platform/src/api'
import { type FileRow, files } from './store'

function searched(base: string, path: string): boolean {
  return under(base, path) && isMarkdown(path) && !hiddenUnder(base, path)
}

const CAP = 24_000_000

let cap = CAP

export function holdAtMost(characters: number): void {
  cap = characters
}

const READ_AT_ONCE = 256

class Held implements SearchNote {
  private lowered: string | null = null
  private lines: readonly number[] | null = null

  constructor(
    readonly path: string,
    readonly relative: string,
    readonly name: string,
    readonly body: string,
  ) {}

  readonly folded = (): string => (this.lowered ??= fold(this.body))
  readonly starts = (): readonly number[] => (this.lines ??= lineStarts(this.body))

  get chars(): number {
    return this.body.length + (this.lowered?.length ?? 0)
  }

  get folds(): number {
    return this.lowered?.length ?? 0
  }

  release(): void {
    this.lowered = null
    this.lines = null
  }
}

class Space {
  private root: string | null = null
  private order: string[] = []
  private held = new Map<string, Held>()
  private whole = false
  private characters = 0
  private dropped = 0
  private read = 0

  warmth(): Warmth {
    return {
      notes: this.held.size,
      of: this.order.length,
      characters: this.characters,
      cap,
      dropped: this.dropped,
      read: this.read,
      warm: this.whole,
    }
  }

  async fill(root: string): Promise<void> {
    const base = normalise(root)
    if (this.root === base && this.whole) return
    if (this.root !== base) this.forget(base)

    const paths = (await files.paths()).filter((path) => searched(base, path))
    if (this.root !== base) return

    this.order = paths

    const listed = new Set(paths)
    for (const path of this.held.keys()) {
      if (!listed.has(path)) this.place(path)
    }

    for (let at = 0; at < paths.length; at += READ_AT_ONCE) {
      const chunk = paths.slice(at, at + READ_AT_ONCE)
      const rows = await files.between(chunk[0] ?? '', chunk.at(-1) ?? '')
      if (this.root !== base) return

      this.read += rows.length
      for (const row of rows) {
        if (searched(base, row.path)) this.keep(base, row)
      }

      await breathe()
      if (this.root !== base) return
    }

    this.whole = true
    this.settle()
  }

  async each(root: string, visit: (note: Held) => boolean): Promise<void> {
    const base = normalise(root)

    try {
      if (this.root !== base || !this.whole) {
        await this.walk(base, visit)
        return
      }

      for (let at = 0; at < this.order.length; at++) {
        const path = this.order[at] ?? ''
        const note = this.held.get(path) ?? (await this.fetch(base, path))
        if (!note) {
          at -= 1
          continue
        }

        if (!visit(note)) return
      }
    } finally {
      this.settle()
    }
  }

  wrote(row: FileRow): void {
    const base = this.root
    if (base === null || !searched(base, row.path)) return

    if (!this.held.has(row.path)) this.place(row.path)
    this.keep(base, row)
  }

  async rewritten(path: string): Promise<void> {
    const base = this.root
    if (base === null || !searched(base, path)) return

    const row = await files.get(path)
    if (row) this.wrote(row)
  }

  gone(path: string): void {
    const at = this.at(path)
    if (this.order[at] === path) this.order.splice(at, 1)

    const note = this.held.get(path)
    if (!note) return

    this.held.delete(path)
    this.characters -= note.chars
  }

  forget(root: string | null): void {
    this.root = root === null ? null : normalise(root)
    this.order = []
    this.held.clear()
    this.whole = false
    this.characters = 0
    this.dropped = 0
    this.read = 0
  }

  private async walk(base: string, visit: (note: Held) => boolean): Promise<void> {
    if (this.root !== base) this.forget(base)
    this.order = []
    const walking = { on: true }

    await files.each((row) => {
      if (!walking.on) return

      this.read += 1
      if (!searched(base, row.path)) return

      this.order.push(row.path)
      if (!visit(this.keep(base, row))) walking.on = false
    })

    if (walking.on) this.whole = true
  }

  private keep(base: string, row: FileRow): Held {
    const was = this.held.get(row.path)
    if (was) this.characters -= was.chars

    const relative = row.path.slice(base === '/' ? 1 : base.length + 1)
    const name = relative.split('/').pop() ?? relative
    const note = new Held(row.path, relative, name, row.content)

    this.held.set(row.path, note)
    this.characters += note.chars
    return note
  }

  private async fetch(base: string, path: string): Promise<Held | null> {
    this.read += 1
    const row = await files.get(path)
    if (!row) {
      this.gone(path)
      return null
    }

    return this.keep(base, row)
  }

  private at(path: string): number {
    let low = 0
    let high = this.order.length

    while (low < high) {
      const middle = (low + high) >> 1
      if ((this.order[middle] ?? '') < path) low = middle + 1
      else high = middle
    }

    return low
  }

  private place(path: string): void {
    const at = this.at(path)
    if (this.order[at] !== path) this.order.splice(at, 0, path)
  }

  private settle(): void {
    let held = 0
    for (const note of this.held.values()) held += note.chars
    this.characters = held
    if (held <= cap) return

    const biggest = [...this.held.values()].sort((one, other) => other.chars - one.chars)

    for (const note of biggest) {
      if (this.characters <= cap) return

      this.characters -= note.folds
      note.release()
    }

    for (const note of biggest) {
      if (this.characters <= cap) break

      this.held.delete(note.path)
      this.characters -= note.chars
      this.dropped += 1
    }
  }
}

export const space = new Space()
