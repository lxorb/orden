import { invoke, isDesktop, platform } from '../tauri'
import { wheelPixels } from '../camera'

const FRESH = 150

const LEARNT = 1.5

const STEADY = 0.3

const GLIDE = 400

const SLOWING = 2

interface Vector {
  x: number
  y: number
}

export interface Wheeled {
  deltaX: number
  deltaY: number
  deltaMode?: number
  timeStamp: number
}

export class FreeScroll {
  private owed: Vector = { x: 0, y: 0 }
  private wheelSum: Vector = { x: 0, y: 0 }
  private rawSum: Vector = { x: 0, y: 0 }
  private touching = false
  private lastRaw = -Infinity
  private lastWheel = -Infinity
  private lastSize = 0
  private ratio: number | null = null
  private heading: Vector | null = null

  fingers(count: number): void {
    const touching = count === 2
    if (touching && !this.touching) this.begin()
    this.touching = touching
  }

  private begin(): void {
    this.owed = { x: 0, y: 0 }
    this.wheelSum = { x: 0, y: 0 }
    this.rawSum = { x: 0, y: 0 }
    this.heading = null
  }

  pan(dx: number, dy: number, now: number): void {
    this.owed = { x: this.owed.x + dx, y: this.owed.y + dy }
    this.lastRaw = now
  }

  wheel(event: Wheeled): Vector {
    const now = event.timeStamp
    const asked = wheelPixels(event)
    const since = now - this.lastWheel
    const size = Math.hypot(asked.x, asked.y)
    const gliding = since < GLIDE && size <= this.lastSize * SLOWING
    this.lastWheel = now
    this.lastSize = size

    if (now - this.lastRaw < FRESH) {
      if (since < FRESH) return this.led(asked)
      this.begin()
      return asked
    }
    if (!gliding) this.heading = null
    if (!this.touching && this.heading) return this.glide(asked)
    return asked
  }

  private led(asked: Vector): Vector {
    const owed = this.owed
    this.owed = { x: 0, y: 0 }
    this.wheelSum = { x: this.wheelSum.x + asked.x, y: this.wheelSum.y + asked.y }
    this.rawSum = { x: this.rawSum.x + owed.x, y: this.rawSum.y + owed.y }

    const across = Math.abs(this.wheelSum.x) >= Math.abs(this.wheelSum.y)
    const raw = across ? this.rawSum.x : this.rawSum.y
    const wheel = across ? this.wheelSum.x : this.wheelSum.y
    if (Math.abs(raw) >= LEARNT && wheel !== 0) this.ratio = wheel / raw

    if (this.ratio === null) return asked

    const out = { x: owed.x * this.ratio, y: owed.y * this.ratio }
    const length = Math.hypot(out.x, out.y)
    if (length > 0) this.heading = { x: out.x / length, y: out.y / length }
    return out
  }

  private glide(asked: Vector): Vector {
    const heading = this.heading
    if (!heading) return asked
    const across = Math.abs(asked.x) >= Math.abs(asked.y)
    const share = across ? heading.x : heading.y
    if (Math.abs(share) < STEADY) return asked

    const along = (across ? asked.x : asked.y) / share
    return { x: heading.x * along, y: heading.y * along }
  }
}

export const freeScroll = new FreeScroll()

let holders = 0
let unhear: (() => void) | null = null

function hear(): void {
  let stopped = false
  const offs: (() => void)[] = []
  unhear = () => {
    stopped = true
    for (const off of offs) off()
  }
  void import('../own-window')
    .then(async ({ hearHere }) => {
      const pans = await hearHere<{ dx: number; dy: number }>('orden://touchpad-pan', (event) => {
        freeScroll.pan(event.payload.dx, event.payload.dy, performance.now())
      })
      const fingers = await hearHere<{ fingers: number }>('orden://touchpad', (event) => {
        freeScroll.fingers(event.payload.fingers)
      })
      if (stopped) {
        pans()
        fingers()
      } else offs.push(pans, fingers)
    })
    .catch(() => undefined)
}

export function holdFreeScroll(): () => void {
  if (!isDesktop || platform() !== 'windows') return () => undefined

  holders += 1
  if (holders === 1) {
    hear()
    void invoke('touchpad_pan', { on: true }).catch(() => undefined)
  }

  let held = true
  return () => {
    if (!held) return
    held = false
    holders -= 1
    if (holders > 0) return
    unhear?.()
    unhear = null
    void invoke('touchpad_pan', { on: false }).catch(() => undefined)
  }
}
