export interface Spot {
  x: number
  y: number
}

export interface Pinched {
  at: Spot
  by: number
  dx: number
  dy: number
}

export class Fingers {
  private readonly down = new Map<number, Spot>()
  private apart = 0
  private middle: Spot = { x: 0, y: 0 }
  lead: number | null = null

  get pinching(): boolean {
    return this.down.size >= 2
  }

  press(id: number, spot: Spot): void {
    this.down.set(id, spot)
    if (this.down.size === 1) this.lead = id
    else this.measure()
  }

  move(id: number, spot: Spot): Pinched | null {
    if (!this.down.has(id)) return null
    this.down.set(id, spot)
    if (!this.pinching) return null

    const apart = this.apart
    const middle = this.middle
    this.measure()
    return {
      at: this.middle,
      by: apart > 0 && this.apart > 0 ? this.apart / apart : 1,
      dx: this.middle.x - middle.x,
      dy: this.middle.y - middle.y,
    }
  }

  lift(id: number): Spot | null {
    const was = this.down.size
    if (!this.down.delete(id)) return null
    if (this.down.size >= 2) this.measure()
    if (this.down.size !== 1) {
      if (!this.down.size) this.lead = null
      return null
    }

    const [left] = [...this.down]
    if (!left) return null
    this.lead = left[0]
    return was >= 2 ? left[1] : null
  }

  private measure(): void {
    const [one, other] = [...this.down.values()]
    if (!one || !other) return
    this.apart = Math.hypot(other.x - one.x, other.y - one.y)
    this.middle = { x: (one.x + other.x) / 2, y: (one.y + other.y) / 2 }
  }
}
