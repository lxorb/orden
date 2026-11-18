import { flushSync, tick } from 'svelte'
import { vi } from 'vitest'

const frame = () =>
  new Promise((done) => {
    requestAnimationFrame(() => done(undefined))
    setTimeout(done, 20)
  })

export async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn++) {
    await vi.dynamicImportSettled()
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0)
    else await frame()
    await tick()
    flushSync()
  }
}

export async function elapse(ms: number): Promise<void> {
  await vi.dynamicImportSettled()
  await vi.advanceTimersByTimeAsync(ms)
  await vi.dynamicImportSettled()
  await vi.advanceTimersByTimeAsync(0)
  flushSync()
}

export async function idle(ms: number): Promise<void> {
  await new Promise((done) => setTimeout(done, ms))
  await settle()
}
