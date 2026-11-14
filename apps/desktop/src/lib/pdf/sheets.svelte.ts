import { SvelteMap } from 'svelte/reactivity'
import { pathKey, windows } from '../platform/src/api'

const SIDECAR = '.highlights.json'

const SAID = 'marks-written'

const written = new SvelteMap<string, number>()

function heard(path: string): void {
  const key = pathKey(path)
  written.set(key, (written.get(key) ?? 0) + 1)
}

export function marksWritten(path: string): void {
  heard(path)
  if (!windows.alone) windows.say(SAID, { path })
}

export function sheetArrived(path: string): void {
  if (path.endsWith(SIDECAR)) marksWritten(path.slice(0, -SIDECAR.length))
}

export function marksFromOutside(path: string): number {
  return written.get(pathKey(path)) ?? 0
}

windows.hear(SAID, ({ path }) => {
  if (typeof path === 'string') heard(path)
})
