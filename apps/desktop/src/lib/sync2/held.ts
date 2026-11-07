import { readCanvas } from '@orden/markdown/canvas'
import { diverge, excerpt, type Excerpt } from '@orden/sync-core/diverge'
import { pullResponseOf } from '@orden/sync-core/wire'
import type { HeldAnswer, Held, HeldNotes, Side } from './asking.svelte'
import type { Core, Holding } from './core'
import { made } from './create'
import { type Doc, MINE } from './docs'
import { fileOfUpdates, turn } from './kinds'
import { folderOf, joined, type SpaceState } from './places'
import { project } from './project'
import { keepLosers } from './rejoin'
import { put, type Change, type EntryRow } from './store'
import * as Y from 'yjs'

interface Sides {
  base: string
  local: string
  remote: string
}

function sidesOf(doc: Doc, against: Holding['against']): Sides {
  if (against.t === 'moved') {
    return {
      base: doc.confirmedText(),
      local: doc.text(),
      remote: fileOfUpdates(doc.shape, doc.whole(), against.update),
    }
  }
  if (against.t === 'blob') return { base: '', local: '', remote: '' }
  return { base: against.base, local: against.local, remote: doc.text() }
}

function remoteOnly(doc: Doc, against: Holding['against']): string {
  if (against.t !== 'moved') return doc.text()
  return fileOfUpdates(doc.shape, doc.row().confirmed, against.update)
}

function planeOf(text: string): string | undefined {
  try {
    readCanvas(text)
    return text
  } catch {
    return undefined
  }
}

function passagesOf(sides: Sides, times: { local: number; remote: number }) {
  const overlaps = diverge(sides.base, sides.local, sides.remote, times).overlaps
  return excerpt(sides.base, sides.local, sides.remote, overlaps)
}

export type Names = (device: string | null) => Promise<string>

export class HeldList implements HeldNotes {
  notes: readonly Held[] = []
  changed: ((notes: readonly Held[]) => void) | null = null
  freshens = true

  constructor(
    private readonly core: Core,
    private readonly names: Names,
  ) {}

  refresh(): Promise<void> {
    return this.core.use(() => this.read())
  }

  private async read(): Promise<void> {
    const out: Held[] = []
    for (const [id, holding] of this.core.held) {
      const space = this.core.spaceOf(id)
      const entry = space?.entries.get(id)
      if (space && entry && holding.against.t === 'blob') {
        out.push(await this.fileHeld(space, entry, holding, holding.against))
        continue
      }
      const doc = await this.core.doc(id)
      if (!space || !entry || !doc) continue
      out.push(await this.heldOf(space, entry, doc, holding))
    }
    this.notes = out
    this.changed?.(out)
  }

  private async heldOf(
    space: SpaceState,
    entry: EntryRow,
    doc: Doc,
    holding: Holding,
  ): Promise<Held> {
    const against = holding.against
    const sides = sidesOf(doc, against)
    const theirsAt = against.t === 'moved' ? against.at : holding.row.at
    const times = { local: doc.pendingAt || holding.row.at, remote: theirsAt }
    const shown = doc.shape === 'plane' ? null : passagesOf(sides, times)
    const side = (text: string, passage: Excerpt | undefined, device: string, at: number): Side => {
      const out: Side = { device, at, excerpt: passage ?? { text: '', marks: [] } }
      const plane = doc.shape === 'plane' ? planeOf(text) : undefined
      if (plane !== undefined) out.plane = plane
      return out
    }
    return {
      id: entry.id,
      path: this.core.world.join(space.row.root, entry.local_path),
      name: entry.name,
      mine: side(sides.local, shown?.local, this.core.world.name, times.local),
      theirs: side(sides.remote, shown?.remote, await this.names(holding.row.device), theirsAt),
    }
  }

  private async fileHeld(
    space: SpaceState,
    entry: EntryRow,
    holding: Holding,
    against: Extract<Holding['against'], { t: 'blob' }>,
  ): Promise<Held> {
    const side = (device: string, at: number): Side => ({
      device,
      at,
      excerpt: { text: '', marks: [] },
      file: { name: entry.name, size: entry.size ?? 0, picture: null },
    })
    return {
      id: entry.id,
      path: this.core.world.join(space.row.root, entry.local_path),
      name: entry.name,
      mine: side(this.core.world.name, holding.row.at),
      theirs: side(await this.names(holding.row.device), against.at),
    }
  }

  answer(id: string, answer: HeldAnswer): Promise<string | undefined> {
    return this.core.use(() => this.answered(id, answer))
  }

  private async answered(id: string, answer: HeldAnswer): Promise<string | undefined> {
    const core = this.core
    const holding = core.held.get(id)
    const space = core.spaceOf(id)
    const entry = space?.entries.get(id)
    if (holding && space && entry && holding.against.t === 'blob') {
      const copy = await this.fileAnswered(space, entry, answer)
      await this.read()
      return copy
    }
    const doc = await core.doc(id)
    if (!holding || !space || !entry || !doc) return undefined

    const against = await this.freshest(space, doc, holding)
    if (against.t === 'blob') return undefined
    const local = against.t === 'moved' ? doc.text() : against.local
    const remote = remoteOnly(doc, against)
    const changes: Change[] = []

    if (answer === 'mine') {
      if (against.t === 'moved') {
        doc.took(against.update, against.seq)
      }
      const now = doc.text()
      doc.write((live) => turn(doc.shape, live, now, local, MINE))
      doc.flush()
      changes.push(...keepLosers(core, space, id, { local: false, remote: true }, local, remote))
    } else {
      if (entry.local_path) {
        await core.world.disk.keep(core.world.join(space.row.root, entry.local_path), local)
      }
      changes.push(...keepLosers(core, space, id, { local: true, remote: false }, local, remote))
      if (against.t === 'moved') {
        doc.restart(fileBytes(doc, against.update), against.seq, doc.epoch, core.freshClient())
      }
    }

    changes.push(...core.letGoChanges(id))
    changes.push(...core.docChanges(doc))
    changes.push(...(await project(core, space, entry, doc)))

    let copy: string | undefined
    if (answer === 'both') {
      const path = this.copyPath(space, entry)
      await core.world.disk.write(core.world.join(space.row.root, path), local)
      const made_ = await made(core, space, { path, folder: false, text: local })
      changes.push(...made_.changes)
      copy = core.world.join(space.row.root, path)
    }

    if (against.t === 'merge') changes.push(...core.forgetChanges(against.from))

    await core.commit(changes)
    await this.read()
    return copy
  }

  private async fileAnswered(
    space: SpaceState,
    entry: EntryRow,
    answer: HeldAnswer,
  ): Promise<string | undefined> {
    const core = this.core
    const full = core.world.join(space.row.root, entry.local_path)
    const changes: Change[] = [...core.letGoChanges(entry.id)]
    let copy: string | undefined
    if (answer === 'mine') {
      entry.written_hash = entry.file_key
      core.touched.add(entry.id)
    } else if (answer === 'theirs') {
      if (entry.local_path) await core.world.disk.remove(full, 'file')
    } else {
      const path = this.copyPath(space, entry)
      await core.world.disk.move(full, core.world.join(space.row.root, path), 'file')
      changes.push(...(await made(core, space, { path, folder: false })).changes)
      copy = core.world.join(space.row.root, path)
    }
    changes.push(put('entries', { ...entry }))
    await core.commit(changes)
    return copy
  }

  private async freshest(
    space: SpaceState,
    doc: Doc,
    holding: Holding,
  ): Promise<Holding['against']> {
    const against = holding.against
    if (against.t !== 'moved' || !this.freshens) return against
    try {
      const reply = await this.core.world.account.ask(
        'pull',
        { docs: [{ id: doc.id, epoch: doc.epoch, sv: doc.confirmedSv() }], part: true },
        space.id,
      )
      const answer = reply === null ? null : pullResponseOf(reply)
      const one = answer?.docs.find((each) => each.id === doc.id)
      if (one && 'update' in one)
        return { t: 'moved', update: one.update, seq: one.seq, at: against.at }
    } catch {
      // Offline or refused: what was held is what there is.
    }
    return against
  }

  private copyPath(space: SpaceState, entry: EntryRow): string {
    const name = entry.name
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const extension = dot > 0 ? name.slice(dot) : ''
    const device = this.core.world.name.replace(/[\\/:*?"<>|]/g, '')
    const folder = folderOf(entry.local_path)
    for (let counter = 1; ; counter += 1) {
      const suffix = counter === 1 ? '' : ` ${String(counter)}`
      const path = joined(folder, `${stem} (${device})${suffix}${extension}`)
      if (!space.at(path)) return path
    }
  }
}

function fileBytes(doc: Doc, update: Uint8Array): Uint8Array {
  return Y.mergeUpdatesV2([doc.row().confirmed, update])
}
