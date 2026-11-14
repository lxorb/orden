const loads = new Map<string, () => Promise<() => void>>()

export function registerCommand(id: string, load: () => Promise<() => void>): () => void {
  loads.set(id, load)
  return () => {
    if (loads.get(id) === load) loads.delete(id)
  }
}

export async function runCommand(id: string): Promise<boolean> {
  const load = loads.get(id)
  const run = load ? await load().catch(() => null) : null
  if (!run) return false
  run()
  return true
}
