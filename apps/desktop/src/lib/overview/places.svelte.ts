import { forget, keepJson, stored, storedText } from '../stored'
import type { Camera } from './camera'
import type { Box } from './layout'
import { type Keyed, lastingKeys } from './tab-keys'

const KEY = 'nib:overview-places'

const WINDOWS = 'nib:overview-windows-2'

const WINDOWS_BEFORE = 'nib:overview-windows'

const CAMERA = 'nib:overview-camera'

const APART = 360

export function readPlaces(value: unknown): Record<string, Box> {
  if (typeof value !== 'object' || value === null) return {}
  const out: Record<string, Box> = {}
  for (const [key, one] of Object.entries(value as Record<string, unknown>)) {
    if (typeof one !== 'object' || one === null) continue
    const { x, y, w, h } = one as Record<string, unknown>
    const numbers = [x, y, w, h]
    if (numbers.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      out[key] = { x: x as number, y: y as number, w: w as number, h: h as number }
    }
  }
  return out
}

export function readCamera(value: unknown): Camera | null {
  if (typeof value !== 'object' || value === null) return null
  const { x, y, zoom } = value as Record<string, unknown>
  const fine = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
  return fine(x) && fine(y) && fine(zoom) && zoom > 0 ? { x, y, zoom } : null
}

export function nextPlace(all: Record<string, Box>, size: { w: number; h: number }): Box {
  const placed = Object.values(all)
  if (!placed.length) return { x: 0, y: 0, ...size }
  const right = Math.max(...placed.map((one) => one.x + one.w))
  const top = Math.min(...placed.map((one) => one.y))
  return { x: right + APART, y: top, ...size }
}

export function upgradeWindows() {
  if (storedText(WINDOWS_BEFORE) === null) return
  const before = readPlaces(stored(WINDOWS_BEFORE))
  const left = Object.entries(before).filter(([name]) => !name.startsWith('web:~'))
  keepJson(WINDOWS, Object.fromEntries(left))
  forget(WINDOWS_BEFORE)
}

class Places {
  private all = $state.raw<Record<string, Box>>(readPlaces(stored(KEY)))
  private put = $state.raw<Record<string, Box>>({})
  private kept: Camera | null = readCamera(stored(CAMERA))

  get camera(): Camera | null {
    return this.kept
  }

  remember(camera: Camera) {
    this.kept = { ...camera }
    keepJson(CAMERA, this.kept)
  }

  get windows(): Readonly<Record<string, Box>> {
    return this.put
  }

  recall(tabs: readonly Keyed[]) {
    const written = readPlaces(stored(WINDOWS))
    const names = lastingKeys(tabs)
    const next = { ...this.put }
    for (const tab of tabs) {
      const box = written[names.get(tab.id) ?? '']
      if (box && !next[tab.id]) next[tab.id] = box
    }
    this.put = next
  }

  keepWindows(lying: Readonly<Record<string, Box>>, tabs: readonly Keyed[]) {
    const open = new Set(tabs.map((one) => one.id))
    const next: Record<string, Box> = {}
    for (const [id, box] of Object.entries({ ...this.put, ...lying }))
      if (open.has(id)) next[id] = { x: box.x, y: box.y, w: box.w, h: box.h }
    this.put = next
    const names = lastingKeys(tabs)
    const written: Record<string, Box> = {}
    for (const [id, box] of Object.entries(next)) {
      const name = names.get(id)
      if (name) written[name] = box
    }
    keepJson(WINDOWS, written)
  }

  forgetWindow(id: string, tabs: readonly Keyed[]) {
    this.put = Object.fromEntries(Object.entries(this.put).filter(([one]) => one !== id))
    this.keepWindows({}, tabs)
  }

  tidy(arranged: Readonly<Record<string, Box>> = {}) {
    this.put = {}
    this.all = { ...arranged }
    keepJson(WINDOWS, {})
    keepJson(KEY, this.all)
  }

  arrange(more: Readonly<Record<string, Box>>) {
    if (!Object.keys(more).length) return
    this.all = { ...this.all, ...more }
    keepJson(KEY, this.all)
  }

  every(): Readonly<Record<string, Box>> {
    return this.all
  }

  at(space: string): Box | null {
    return this.all[space] ?? null
  }

  place(space: string, size: { w: number; h: number }): Box {
    const known = this.all[space]
    if (known) return known
    const made = nextPlace(this.all, size)
    this.all = { ...this.all, [space]: made }
    keepJson(KEY, this.all)
    return made
  }
}

export const places = new Places()
