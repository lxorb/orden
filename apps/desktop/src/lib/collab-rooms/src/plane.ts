import type { Canvas, InkStroke } from '@orden/markdown/canvas'
import { type PlaneSurface, type Point, type SharedPlane } from '@orden/markdown/plane'
import { HAND, handsIn, saidHand } from './hands'
import { type Entering, JoinedRoom } from './joined'
import { PlaneBinding } from './plane-bind'

export interface Drawing extends Entering {
  surface: PlaneSurface
  holds: () => boolean
}

export class PlaneRoom extends JoinedRoom implements SharedPlane {
  private readonly binding: PlaneBinding

  constructor(private readonly joining: Drawing) {
    super(joining)
    this.binding = new PlaneBinding(this.door.doc, joining.surface, () => this.holds())
  }

  get settled(): boolean {
    return this.door.caughtUp
  }

  push(before: Canvas, after: Canvas) {
    this.binding.push(before, after)
  }

  undo(): boolean {
    return this.binding.undo()
  }

  redo(): boolean {
    return this.binding.redo()
  }

  hand(at: Point | null, drawing: InkStroke | null) {
    this.door.announce(HAND, () => (at ? saidHand(at, drawing) : null))
  }

  leave() {
    this.left = true
    this.joining.surface.shared = null
    this.joining.surface.handsAre([])
    this.binding.part()
    this.door.leave()
    this.joining.onPeers(0)
  }

  protected together() {
    if (!this.holds()) return

    this.binding.together()
    this.joining.surface.shared = this
  }

  protected showPresent() {
    const { present, hands, seen } = handsIn(this.door.awareness, this.door.doc, this.scheme)

    this.joining.surface.handsAre(hands)
    this.joining.onPeers(present, seen)
  }
}
