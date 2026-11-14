import { isRecord, keepJson, stored } from '../platform/src/api'

const STORAGE_KEY = 'orden:web-places'

const KEEPS = 200

export interface Place {
  url: string
  y: number
  x: number
  trail?: string[]
  at?: number
}

function readPlace(value: unknown): Place | null {
  if (!isRecord(value)) return null

  const { url, x, y, trail, at } = value
  if (typeof url !== 'string' || typeof x !== 'number' || typeof y !== 'number') return null

  const walked = Array.isArray(trail)
    ? trail.filter((one): one is string => typeof one === 'string')
    : []

  return {
    url,
    x,
    y,
    ...(walked.length ? { trail: walked } : {}),
    ...(typeof at === 'number' ? { at } : {}),
  }
}

function all(): Record<string, Place> {
  const read = stored(STORAGE_KEY)
  if (!isRecord(read)) return {}

  const out: Record<string, Place> = {}
  for (const [path, value] of Object.entries(read)) {
    const said = readPlace(value)
    if (said) out[path] = said
  }
  return out
}

export function placeOf(path: string | null): Place | null {
  if (!path) return null
  return all()[path] ?? null
}

export function placeKept(path: string | null, place: Place) {
  if (!path) return

  const held = all()
  const others = Object.entries(held).filter(([one]) => one !== path)
  const kept = [...others.slice(Math.max(0, others.length + 1 - KEEPS)), [path, place] as const]

  keepJson(STORAGE_KEY, Object.fromEntries(kept))
}

export function placesForgotten(urls: ReadonlySet<string> | null) {
  const held = all()
  const left = Object.entries(held).filter(
    ([, place]) =>
      urls !== null && !urls.has(place.url) && !(place.trail ?? []).some((one) => urls.has(one)),
  )
  if (left.length !== Object.keys(held).length) keepJson(STORAGE_KEY, Object.fromEntries(left))
}
