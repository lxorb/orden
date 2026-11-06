import type { Lanes } from './records'

export type Lane = 'space' | 'site'

export interface Place {
  key: string
  name: string
}

export interface Seen {
  at: number
  active: boolean
  space: Place | null
  site: Place | null
}

export interface Writer {
  opened(lane: Lane, place: Place, at: number): string
  moved(id: string, end: number): boolean
}

interface Open {
  id: string
  key: string
  start: number
  end: number
  written: number
}

export const GAP = 90_000

export const WRITE_EVERY = 60_000

export class Tracker {
  private readonly open: Record<Lane, Open | null> = { space: null, site: null }

  constructor(private readonly writer: Writer) {}

  seen(seen: Seen, lanes: Lanes): void {
    this.lane('space', seen.active && lanes.spaces ? seen.space : null, seen.at)
    this.lane('site', seen.active && lanes.sites ? seen.site : null, seen.at)
  }

  private lane(lane: Lane, place: Place | null, at: number): void {
    const open = this.open[lane]
    if (open && place?.key === open.key && at >= open.end && at - open.end <= GAP) {
      open.end = at
      if (open.written === open.start || at - open.written >= WRITE_EVERY) this.written(lane)
      if (this.open[lane]) return
    }
    if (this.open[lane]) this.closed(lane)
    if (!place) return
    const id = this.writer.opened(lane, place, at)
    this.open[lane] = { id, key: place.key, start: at, end: at, written: at }
  }

  private written(lane: Lane): void {
    const open = this.open[lane]
    if (!open) return
    if (this.writer.moved(open.id, open.end)) open.written = open.end
    else this.open[lane] = null
  }

  private closed(lane: Lane): void {
    const open = this.open[lane]
    if (open && open.end !== open.written) this.written(lane)
    this.open[lane] = null
  }

  flush(): void {
    for (const lane of ['space', 'site'] as const) {
      const open = this.open[lane]
      if (open && open.end !== open.written) this.written(lane)
    }
  }
}

export function siteOf(address: string | null | undefined): string | null {
  if (!address) return null
  try {
    const url = new URL(address)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}
