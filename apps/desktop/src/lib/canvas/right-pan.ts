export const RIGHT_SLOP = 4

const AFTER = 600

interface Press {
  id: number
  x: number
  y: number
  moved: boolean
}

interface Reported {
  pointerId: number
  pointerType: string
  button: number
  clientX: number
  clientY: number
  timeStamp: number
}

export class RightPan {
  private press: Press | null = null
  private ended = -Infinity

  down(event: Reported): boolean {
    if (event.button !== 2 || event.pointerType !== 'mouse') return false
    this.press = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
    return true
  }

  get holding(): boolean {
    return this.press !== null
  }

  move(event: Reported): { dx: number; dy: number } | null {
    const press = this.press
    if (press?.id !== event.pointerId) return null

    const dx = event.clientX - press.x
    const dy = event.clientY - press.y
    if (!press.moved && Math.hypot(dx, dy) <= RIGHT_SLOP) return null

    this.press = { ...press, x: event.clientX, y: event.clientY, moved: true }
    return { dx, dy }
  }

  up(event: Reported): 'menu' | 'panned' | null {
    const press = this.press
    if (press?.id !== event.pointerId) return null

    this.press = null
    this.ended = event.timeStamp
    return press.moved ? 'panned' : 'menu'
  }

  cancel(): void {
    if (this.press) this.ended = performance.now()
    this.press = null
  }

  ownsMenu(now: number): boolean {
    return this.press !== null || now - this.ended < AFTER
  }
}
