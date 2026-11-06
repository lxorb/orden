import { within } from '../space-paths'

const flying: string[] = []
const landed = new Set<() => void>()

export async function moving<T>(to: string, run: () => Promise<T>): Promise<T> {
  flying.push(to)
  try {
    return await run()
  } finally {
    flying.splice(flying.indexOf(to), 1)
    for (const listener of [...landed]) listener()
  }
}

export function landing(path: string): boolean {
  for (const to of flying) if (within(to, path) !== null) return true
  return false
}

export function onLanded(listener: () => void): () => void {
  landed.add(listener)
  return () => landed.delete(listener)
}
