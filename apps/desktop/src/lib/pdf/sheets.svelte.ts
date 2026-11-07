import { SvelteMap } from 'svelte/reactivity'

const written = new SvelteMap<string, number>()

export function marksWritten(path: string): void {
  written.set(path, (written.get(path) ?? 0) + 1)
}

export function marksFromOutside(path: string): number {
  return written.get(path) ?? 0
}
