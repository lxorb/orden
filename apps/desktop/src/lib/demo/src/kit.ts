import { samePath } from '../../platform/src/api'
import { type Tab, workspace } from '../../workspace/src/api'
import { moveAt, type Move } from './motion'
import { boxOf, type Point, type Pointer } from './pointer'

export interface LoopScene {
  period: number
  still: number
  ready?: () => Promise<void>
  tick: (phase: number, now: number) => void
}
export const clamp = (value: number) => Math.min(1, Math.max(0, value))
export const smooth = (value: number) => value * value * (3 - 2 * value)
export const scheme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
export const phone = () => document.documentElement.dataset.demo === 'phone'
export const pause = (ms: number) => new Promise((done) => setTimeout(done, ms))
export const frame = () => new Promise((done) => requestAnimationFrame(done))
export const until = async <T>(found: () => T | null | undefined): Promise<T> => {
  for (;;) {
    const one = found()
    if (one) return one
    await pause(30)
  }
}
export async function opened(path: string): Promise<Tab> {
  await workspace.open(path)
  return until(() => workspace.tabs.find((one) => samePath(one.path, path)))
}
export const rest = (): Point => ({ x: innerWidth * 0.74, y: innerHeight * 0.8 })
export const tabButton = (tab: () => Tab | null) => () => {
  const one = tab()
  return one ? boxOf(`button.pick[data-tab="${one.id}"]`) : null
}
export const nudged = (at: () => Point | null, dx: number, dy: number) => () => {
  const point = at()
  return point ? { x: point.x + dx, y: point.y + dy } : null
}
export const endOf =
  (selector: string, inset = 14) =>
  () => {
    const box = document.querySelector(selector)?.getBoundingClientRect()
    return box?.width ? { x: box.right - inset, y: box.top + box.height / 2 } : null
  }
export function stepper(go: (to: number) => Promise<void>) {
  let now = 0
  let wanted = 0
  let busy = false
  const run = async () => {
    busy = true
    try {
      while (now !== wanted) {
        const next = wanted
        await go(next)
        now = next
      }
    } finally {
      busy = false
    }
  }
  return (to: number) => {
    wanted = to
    if (!busy && now !== wanted) void run()
  }
}
export const stepOf = (at: number, edges: readonly number[]) => {
  const index = edges.findIndex((one) => at < one)
  return index === -1 ? edges.length : index
}
export const shown = (who: Pointer, ms: number, moves: readonly Move[]) => {
  const { at, press } = moveAt(ms, moves)
  who.show(at, press)
}
export function fill(field: HTMLInputElement | HTMLTextAreaElement | null | undefined, value: string): void {
  if (!field || field.value === value) return
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
}
