export const GRACE = 150
export const EDGE = 3

export interface Moved {
  clientX: number
  clientY: number
  buttons: number
  pointerType: string
}

export interface Room {
  may: () => boolean
  width: () => number
  rtl: () => boolean
  top?: () => number
  over: (x: number, y: number) => boolean
  busy: () => boolean
}

type Timer = ReturnType<typeof setTimeout>

export class EdgePeek {
  out = $state(false)

  constructor(private readonly end = false) {}

  private room: Room | null = null
  private going: Timer | null = null

  watch(room: Room): () => void {
    this.room = room
    return () => {
      this.room = null
      this.stay()
      this.out = false
    }
  }

  moved(event: Moved) {
    const room = this.room
    if (!room) return

    const right = room.rtl() !== this.end
    const edge = right ? event.clientX >= room.width() - 1 - EDGE : event.clientX <= EDGE
    const beside = event.clientY >= (room.top?.() ?? 0)

    if (this.out) {
      if (room.over(event.clientX, event.clientY) || (edge && beside)) this.stay()
      else this.leave()
      return
    }
    if (edge && beside && event.buttons === 0 && event.pointerType !== 'touch' && room.may())
      this.out = true
  }

  away() {
    if (this.out) this.leave()
  }

  hide() {
    this.stay()
    this.out = false
  }

  private stay() {
    if (this.going === null) return
    clearTimeout(this.going)
    this.going = null
  }

  private leave() {
    this.going ??= setTimeout(() => this.gone(), GRACE)
  }

  private gone() {
    this.going = null
    if (!this.out) return
    if (this.room?.busy()) {
      this.going = setTimeout(() => this.gone(), GRACE)
      return
    }
    this.out = false
  }
}

export const edgePeek = new EdgePeek()
export const endPeek = new EdgePeek(true)
