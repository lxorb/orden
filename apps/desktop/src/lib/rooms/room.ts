import { setPeers, type SharedDoc } from '@orden/editor'
import { TEXT } from '@orden/rooms'
import type { Settling } from './apart'
import { bind, replace } from './bind'
import { HERE } from './door'
import { type Base, meeting } from './join'
import { type Entering, JoinedRoom } from './joined'
import { peersIn, relative } from './peers'

export interface Joining extends Entering {
  note: SharedDoc
  hash: string | null
  digest: (text: string) => Promise<string>
  apart: (theirs: string) => Promise<Settling>
  holds: () => boolean
}

const REMEMBERED = 60_000

const shared = new Map<string, { words: string; at: number }>()

function sharedBefore(noteId: string): string | null {
  const kept = shared.get(noteId)
  shared.delete(noteId)
  return kept && Date.now() - kept.at < REMEMBERED ? kept.words : null
}

async function writtenAs(
  words: string,
  hash: string,
  digest: (text: string) => Promise<string>,
): Promise<boolean> {
  if ((await digest(words)) === hash) return true
  return words.includes('\n') && (await digest(words.replace(/\r?\n/g, '\r\n'))) === hash
}

export class Room extends JoinedRoom {
  private unbind: (() => void) | null = null
  private awaiting = false

  constructor(private readonly joining: Joining) {
    super(joining)
  }

  get settled(): boolean {
    return this.door.caughtUp && this.unbind !== null
  }

  get bound(): boolean {
    return this.unbind !== null
  }

  get waiting(): boolean {
    return this.awaiting
  }

  private get text() {
    return this.door.doc.getText(TEXT)
  }

  moved(anchor: number, head: number) {
    if (!this.unbind) return
    this.door.announce('caret', () => ({
      anchor: relative(this.text, anchor),
      head: relative(this.text, head),
    }))
  }

  leave() {
    this.left = true
    this.unbind?.()
    this.unbind = null
    this.door.leave()
    this.joining.note.announce([setPeers.of([])])
    this.joining.onPeers(0)
  }

  protected async together() {
    const base = await this.startedFrom()
    if (base === undefined) return

    if (await this.settleAgainst(base)) {
      this.unbind = bind(this.joining.note, this.text, () => this.holds())
      this.showPresent()
    }
  }

  private async startedFrom(): Promise<Base | null | undefined> {
    const { note, hash, digest } = this.joining
    const before = sharedBefore(this.joining.noteId)
    if (!this.holds()) return undefined
    if (hash === null) return null

    const asked = note.text.toString()
    const asksRoom = this.text.toJSON()
    const [mine, theirs] = await Promise.all([
      writtenAs(asked, hash, digest),
      writtenAs(asksRoom, hash, digest),
    ])
    if (!this.holds()) return undefined

    return {
      mine: (mine || asked === before) && note.text.toString() === asked,
      theirs: (theirs || asksRoom === before) && this.text.toJSON() === asksRoom,
    }
  }

  protected override rebuilt() {
    if (this.unbind) shared.set(this.joining.noteId, { words: this.text.toJSON(), at: Date.now() })
  }

  private async settleAgainst(base: Base | null): Promise<boolean> {
    const { note } = this.joining
    const met = meeting(note.text.toString(), this.text.toJSON(), base)

    if (met.kind === 'take') note.arrived([met.change])
    if (met.kind === 'offer') this.door.doc.transact(() => replace(this.text, met.change), HERE)
    if (met.kind !== 'apart') return true

    const answer = await this.joining.apart(this.text.toJSON())
    if (!this.holds()) return false

    if (answer === 'wait') {
      this.awaiting = true
      return false
    }

    return await this.settleAgainst(
      answer === 'take' ? { mine: true, theirs: false } : { mine: false, theirs: true },
    )
  }

  protected showPresent() {
    const { present, carets, seen } = peersIn(this.door.awareness, this.door.doc, this.scheme)

    const ours = this.unbind && this.holds() ? carets : []
    this.joining.note.announce([setPeers.of(ours)])
    this.joining.onPeers(present, seen)
  }
}
