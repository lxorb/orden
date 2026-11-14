import { IDLE_AFTER, INPUT_EVERY } from '../platform/src/api'

export interface SystemInput {
  idleMs: number
  front: boolean
}

export interface ActivityWorld {
  now(): number
  system(): Promise<SystemInput | null>
  listen(heard: () => void): () => void
  every(ms: number, tick: () => void): () => void
}

export function readSystemInput(value: unknown): SystemInput | null {
  if (typeof value !== 'object' || value === null) return null
  const said = value as Record<string, unknown>
  return typeof said.idleMs === 'number' && typeof said.front === 'boolean'
    ? { idleMs: said.idleMs, front: said.front }
    : null
}

export class Activity {
  active = true

  private last: number
  private readonly heard = new Set<(active: boolean) => void>()
  private stops: (() => void)[] = []

  constructor(private readonly world: ActivityWorld) {
    this.last = world.now()
  }

  start(): () => void {
    this.stops = [
      this.world.listen(() => {
        this.touched()
      }),
      this.world.every(INPUT_EVERY, () => void this.check()),
    ]
    return () => {
      for (const stop of this.stops) stop()
      this.stops = []
    }
  }

  changed(run: (active: boolean) => void): () => void {
    this.heard.add(run)
    return () => this.heard.delete(run)
  }

  touched(): void {
    this.last = this.world.now()
    this.become(true)
  }

  async check(): Promise<void> {
    const system = await this.world.system().catch(() => null)
    if (system?.front) this.last = Math.max(this.last, this.world.now() - system.idleMs)

    this.become(this.world.now() - this.last < IDLE_AFTER)
  }

  private become(active: boolean): void {
    if (active === this.active) return
    this.active = active
    for (const run of this.heard) run(active)
  }
}

export function listenForInput(heard: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined

  let at = 0
  const input = () => {
    const now = Date.now()
    if (now - at < 1000) return
    at = now
    heard()
  }
  const kinds = ['keydown', 'pointerdown', 'pointermove', 'wheel'] as const
  for (const kind of kinds) window.addEventListener(kind, input, { capture: true, passive: true })
  return () => {
    for (const kind of kinds) window.removeEventListener(kind, input, { capture: true })
  }
}
