const owing = new Set<() => void>()

const lastly = new Set<() => void>()

export function owes(write: () => void): void {
  owing.add(write)
}

export function owesLast(write: () => void): void {
  lastly.add(write)
}

const surfaces = new Set<() => void>()

export function owesWords(write: () => void): void {
  surfaces.add(write)
  owing.add(write)
}

export function surfacesToWords(): void {
  for (const write of surfaces) write()
}

const ending = new Set<() => void>()

export function owesAtTheEnd(write: () => void): void {
  ending.add(write)
}

export function writeOwed(): void {
  for (const write of owing) write()
  for (const write of lastly) write()
}

export function settleUp(): void {
  writeOwed()
  for (const write of ending) write()
}

export const GIVE_UP = 3000

const underway = new Set<Promise<unknown>>()

export function writing(work: Promise<unknown>): void {
  const done = work.catch(() => undefined)
  underway.add(done)
  void done.then(() => underway.delete(done))
}

export function stillWriting(): boolean {
  return underway.size > 0
}

export async function written(): Promise<void> {
  while (underway.size) await Promise.all(underway)
}

let tray: (() => Promise<boolean>) | null = null

export function keptInTray(hide: (() => Promise<boolean>) | null): void {
  tray = hide
}

export function trayKeeper(): (() => Promise<boolean>) | null {
  return tray
}

const running = new Set<() => boolean>()

export const runs = (any: () => boolean) => void running.add(any)

export const anythingRuns = () => [...running].some((any) => any())
