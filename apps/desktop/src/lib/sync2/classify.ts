import type { Times } from '@orden/sync-core'
import { judge, type Judged, type Shape } from './kinds'

export interface Judging {
  shape: Shape
  base: string
  local: string
  remote: string
  times: Times
  merged?: string
}

export type Classify = (judging: Judging) => Promise<Judged>

export const inline: Classify = (one) =>
  Promise.resolve(judge(one.shape, one.base, one.local, one.remote, one.times, one.merged))

export const LARGE = 64 * 1024

export function classifier(): Classify {
  let worker: Worker | null = null
  let asked = 0
  const waiting = new Map<number, (judged: Judged | null) => void>()

  const open = (): Worker | null => {
    if (worker) return worker
    try {
      const made = new Worker(new URL('./classify-worker.ts', import.meta.url), {
        type: 'module',
      })
      made.onmessage = (event: MessageEvent<{ id: number; judged: Judged | null }>) => {
        waiting.get(event.data.id)?.(event.data.judged)
        waiting.delete(event.data.id)
      }
      made.onerror = () => {
        for (const one of waiting.values()) one(null)
        waiting.clear()
        worker?.terminate()
        worker = null
      }
      worker = made
      return made
    } catch {
      return null
    }
  }

  return async (one) => {
    const size = one.base.length + one.local.length + one.remote.length
    const away = size >= LARGE ? open() : null
    if (!away) return inline(one)
    const id = ++asked
    const judged = await new Promise<Judged | null>((resolve) => {
      waiting.set(id, resolve)
      away.postMessage({ id, judging: one })
    })
    return judged ?? inline(one)
  }
}
