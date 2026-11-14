export type Side = 'left' | 'right'

export type Source = 'touchpad' | 'touch'

export const START: Record<Source, number> = { touchpad: 60, touch: 50 }

const SHARE: Record<Source, number> = { touchpad: 0.3, touch: 0.25 }

export const RATIO = 2.5

export const FLING = 1.1

export const QUIET = 120

const COAST_RUN = 4
const COAST_FROM = 0.3
const COAST_KEEPS: readonly [number, number] = [0.55, 0.98]

const LEAST = 80

export const MOST = 200

export const SETTLE = 300

const WINDOW = 80

const HELD = QUIET / 2

export const BACKING = 0.5

export interface Turn {
  dx: number
  dy: number
  at: number
  scrolls: Record<Side, boolean>
  goes: Record<Side, boolean>
}

export type Phase = 'idle' | 'gathering' | 'content' | 'tracking' | 'went' | 'stayed'

export interface Shown {
  phase: Phase
  side: Side
  progress: number
  travel: number
}

export function distance(source: Source, width: number, height: number): number {
  const share = Math.max(width, height) * SHARE[source] - START[source]
  return Math.min(MOST, Math.max(LEAST, share))
}

function sideOf(dx: number): Side {
  return dx < 0 ? 'left' : 'right'
}

export class Swipe {
  private phase: Phase = 'idle'
  private side: Side = 'left'
  private across = 0
  private down = 0
  private travel = 0
  private leaning = false
  private pushed = 0
  private trail: { at: number; pushed: number }[] = []
  private last = 0
  private steps: { along: number; gap: number }[] = []

  constructor(
    private readonly source: Source,
    private readonly room: () => { width: number; height: number },
    private readonly told = source === 'touch',
  ) {}

  get shown(): Shown {
    const travel = this.drawn()
    const progress = travel / (this.far() + START[this.source])
    return { phase: this.phase, side: this.side, progress, travel }
  }

  get asking(): boolean {
    return this.phase === 'idle' || this.phase === 'gathering'
  }

  turn(step: Turn): Shown {
    switch (this.phase) {
      case 'idle':
        this.reset()
        this.phase = 'gathering'
        this.gather(step)
        break
      case 'gathering':
        this.gather(step)
        break
      case 'tracking':
        this.track(step)
        break
      case 'content':
      case 'went':
      case 'stayed':
        break
    }
    this.last = step.at
    return this.shown
  }

  lift(at: number): Shown {
    const tracking = this.phase === 'tracking'
    if (tracking) {
      const speed = at - this.last > HELD ? 0 : this.speed()
      this.decide(speed, this.travel)
    }
    const decided: Shown = tracking
      ? this.shown
      : { phase: 'idle', side: this.side, progress: 0, travel: 0 }
    this.reset()
    return decided
  }

  private reset() {
    this.phase = 'idle'
    this.leaning = false
    this.across = 0
    this.down = 0
    this.travel = 0
    this.pushed = 0
    this.trail = []
    this.steps = []
  }

  private gather(step: Turn) {
    if (step.dx !== 0 && step.scrolls[sideOf(step.dx)]) {
      this.phase = 'content'
      return
    }

    this.across += step.dx
    this.down += step.dy
    const start = START[this.source]
    const across = Math.abs(this.across)
    const down = Math.abs(this.down)

    if (down > start && down > across * RATIO) {
      this.phase = 'content'
      this.leaning = false
      return
    }
    if (across <= start || across <= down * RATIO) {
      this.leaning = across > 0 && across > down * RATIO && step.goes[sideOf(this.across)]
      if (this.leaning) this.side = sideOf(this.across)
      return
    }

    this.leaning = false
    this.side = sideOf(this.across)
    this.phase = step.goes[this.side] ? 'tracking' : 'stayed'
    this.travel = this.phase === 'tracking' ? across - start : -start
    this.pushed = this.travel
    this.trail = [{ at: step.at, pushed: this.pushed }]
  }

  private track(step: Turn) {
    const along = this.side === 'left' ? -step.dx : step.dx
    this.travel = Math.max(-START[this.source], this.travel + along)
    this.pushed += along
    const recent = this.trail.filter((one) => one.at >= step.at - WINDOW * 2)
    this.trail = [...recent, { at: step.at, pushed: this.pushed }]

    const gap = step.at - this.last
    if (gap <= 0) return
    this.steps = [...this.steps.slice(1 - COAST_RUN), { along, gap }]

    const coast = this.told ? null : coasting(this.steps)
    if (coast !== null) this.decide(coast.from, this.travel + coast.left)
  }

  private speed(): number {
    const newest = this.trail[this.trail.length - 1]
    if (!newest) return 0
    const oldest =
      this.trail.find((one) => one !== newest && one.at >= newest.at - WINDOW) ??
      this.trail[this.trail.length - 2]
    if (!oldest || newest.at <= oldest.at) return 0
    return (newest.pushed - oldest.pushed) / (newest.at - oldest.at)
  }

  private decide(speed: number, reached: number) {
    const { width, height } = this.room()
    const far = distance(this.source, width, height)
    const went = reached >= far || (speed >= FLING && this.travel > 0)
    this.phase = went && speed > -BACKING ? 'went' : 'stayed'
  }

  private far(): number {
    const { width, height } = this.room()
    return distance(this.source, width, height)
  }

  private drawn(): number {
    if (this.phase === 'gathering') return this.leaning ? Math.abs(this.across) : 0
    if (this.phase === 'idle' || this.phase === 'content') return 0
    return Math.max(0, this.travel + START[this.source])
  }
}

export function coasting(
  steps: readonly { along: number; gap: number }[],
): { from: number; left: number } | null {
  if (steps.length < COAST_RUN) return null
  const speeds = steps.map((one) => one.along / one.gap)
  const first = speeds[0] ?? 0
  if (first < COAST_FROM) return null

  const [least, most] = COAST_KEEPS
  let kept = 0
  for (let at = 1; at < speeds.length; at++) {
    const share = (speeds[at] ?? 0) / (speeds[at - 1] ?? 1)
    if (share < least || share > most) return null
    kept += share
  }

  const keeps = kept / (speeds.length - 1)
  const newest = steps[steps.length - 1]?.along ?? 0
  return { from: first, left: (newest * keeps) / (1 - keeps) }
}
