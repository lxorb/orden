import type { Camera } from '../camera'
import { isRecord, keepJson, stored } from '../platform/src/api'

const STORAGE_KEY = 'orden:canvas-views'

const KEEPS = 300

export interface KeptView extends Camera {
  chose?: boolean
}

function readView(value: unknown): KeptView | null {
  if (!isRecord(value)) return null

  const { x, y, scale, chose, turn } = value
  if (typeof x !== 'number' || typeof y !== 'number' || typeof scale !== 'number') return null

  const turning = typeof turn === 'number' && Number.isFinite(turn) && turn ? { turn } : {}
  return chose === true ? { x, y, scale, chose: true, ...turning } : { x, y, scale, ...turning }
}

function all(): Record<string, KeptView> {
  const read = stored(STORAGE_KEY)
  if (!isRecord(read)) return {}

  const out: Record<string, KeptView> = {}
  for (const [path, value] of Object.entries(read)) {
    const view = readView(value)
    if (view) out[path] = view
  }
  return out
}

export function viewOf(path: string | null): KeptView | null {
  if (!path) return null
  return all()[path] ?? null
}

export function viewKept(path: string | null, view: KeptView) {
  if (!path) return

  const held = all()
  const others = Object.entries(held).filter(([one]) => one !== path)
  const kept = [...others.slice(Math.max(0, others.length + 1 - KEEPS)), [path, view] as const]

  keepJson(STORAGE_KEY, Object.fromEntries(kept))
}
