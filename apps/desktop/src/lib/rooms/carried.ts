import { setPeers, type SharedDoc } from '@orden/editor'
import { readSync, receive, syncStep1Of, syncStep2Of, TEXT } from '@orden/rooms'
import { DEVICE_PROTOCOL, NEW_EPOCH, roomNews, ROOM_V2 } from '@orden/sync-core/wire'
import type { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import type { InkStroke } from '../canvas/format'
import type { Point } from '../canvas/geometry'
import type { PlaneSurface } from '../canvas/shared'
import { type Opening, ROOM, RoomDoor } from './door'
import { HAND, handsIn, saidHand } from './hands'
import { type Entering, JoinedRoom } from './joined'
import { peersIn, relative } from './peers'

export interface Carrying {
  doc: Y.Doc
  device: string
  pending(): boolean
  confirmedSv(): Uint8Array
  met(update: Uint8Array): Promise<'go' | 'hold'>
  acked(seq: number, sv: Uint8Array): void
  epoch(epoch: number, base: string): void
  live(on: boolean): void
}

class CarryingDoor extends RoomDoor {
  private meeting = false
  private asked: Uint8Array | null = null
  private waiting: Uint8Array[] = []

  constructor(
    opening: Opening,
    private readonly carrying: Carrying,
  ) {
    super(opening, carrying.doc, [ROOM_V2, `${DEVICE_PROTOCOL}${carrying.device}`])
  }

  protected override greet() {
    this.meeting = this.carrying.pending()
    this.asked = null
    this.waiting = []
    this.greeted = false
    this.settled = false
    super.greet()
  }

  protected override question(): Uint8Array {
    return this.meeting ? syncStep1Of(this.carrying.confirmedSv()) : super.question()
  }

  protected override sending(): boolean {
    return !this.meeting
  }

  protected override went(code: number, said: string) {
    this.carrying.live(false)
    if (code === NEW_EPOCH) {
      this.socket.stop()
      this.opening.gone()
      return
    }
    super.went(code, said)
  }

  protected override async hear(message: Uint8Array) {
    const news = roomNews(message)
    if (news?.t === 'ack') this.carrying.acked(news.seq, news.sv)
    if (news?.t === 'epoch') this.carrying.epoch(news.epoch, news.epochBase)
    if (news) return
    if (this.meeting) await this.meet(message)
    else await super.hear(message)
  }

  protected override async together() {
    await super.together()
    this.carrying.live(true)
  }

  protected override dropped() {
    this.carrying.live(false)
  }

  private async meet(message: Uint8Array) {
    const sync = readSync(message)
    if (!sync) {
      receive(message, this.doc, this.awareness, ROOM)
      return
    }
    if (sync.kind === 'step1') {
      this.asked = sync.sv
      return
    }
    if (sync.kind === 'update') {
      this.waiting.push(sync.update)
      return
    }
    if (this.greeted) return
    this.greeted = true

    if ((await this.carrying.met(sync.update)) === 'hold') {
      this.socket.stop()
      this.alone()
      return
    }

    for (const update of this.waiting) Y.applyUpdate(this.doc, update, ROOM)
    this.waiting = []
    this.meeting = false
    if (this.asked) this.socket.send(syncStep2Of(Y.encodeStateAsUpdate(this.doc, this.asked)))
    this.asked = null
    await this.together()
  }
}

export interface Carried extends Entering {
  note: Pick<SharedDoc, 'announce'>
  carrying: Carrying
}

export class CarriedRoom extends JoinedRoom {
  constructor(private readonly carried: Carried) {
    super(carried)
  }

  protected override opened(entering: Entering, opening: Opening): RoomDoor {
    return new CarryingDoor(opening, (entering as Carried).carrying)
  }

  get settled(): boolean {
    return this.door.caughtUp
  }

  get awareness(): Awareness {
    return this.door.awareness
  }

  moved(anchor: number, head: number) {
    const text = this.door.doc.getText(TEXT)
    this.door.announce('caret', () => ({
      anchor: relative(text, anchor),
      head: relative(text, head),
    }))
  }

  leave() {
    this.left = true
    this.door.leave()
    this.carried.note.announce([setPeers.of([])])
    this.carried.onPeers(0)
  }

  protected together() {
    return undefined
  }

  protected showPresent() {
    const { present, carets, seen } = peersIn(this.door.awareness, this.door.doc, this.scheme)
    this.carried.note.announce([setPeers.of(carets)])
    this.carried.onPeers(present, seen)
  }
}

export interface CarriedPlane extends Entering {
  surface: PlaneSurface
  carrying: Carrying
}

export class CarriedPlaneRoom extends JoinedRoom {
  constructor(private readonly carried: CarriedPlane) {
    super(carried)
  }

  protected override opened(entering: Entering, opening: Opening): RoomDoor {
    return new CarryingDoor(opening, (entering as CarriedPlane).carrying)
  }

  get settled(): boolean {
    return this.door.caughtUp
  }

  hand(at: Point | null, drawing: InkStroke | null) {
    this.door.announce(HAND, () => (at ? saidHand(at, drawing) : null))
  }

  moved() {
    return undefined
  }

  leave() {
    this.left = true
    this.door.leave()
    this.carried.surface.handsAre([])
    this.carried.onPeers(0)
  }

  protected together() {
    return undefined
  }

  protected showPresent() {
    const { present, hands, seen } = handsIn(this.door.awareness, this.door.doc, this.scheme)
    this.carried.surface.handsAre(hands)
    this.carried.onPeers(present, seen)
  }
}
