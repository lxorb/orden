import { isUntouchedAgents } from './agents-seed'
import { isUntouchedWelcome } from './welcome'

export interface Listed {
  path: string
  is_dir: boolean
  children: Listed[]
  evicted?: boolean
  unlisted?: boolean
}

export interface Reading {
  tree(root: string): Promise<Listed | null>
  note(path: string): Promise<string | null>
}

async function holdsOnlySeeds(tree: Listed, read: Reading['note']): Promise<boolean> {
  for (const child of tree.children) {
    if (child.is_dir || child.evicted || child.unlisted) return false
    const words = await read(child.path)
    if (words === null) return false
    if (!isUntouchedWelcome(child.path, words) && !isUntouchedAgents(child.path, words)) {
      return false
    }
  }
  return true
}

export async function untouchedSeedSpace(
  seeded: string | null,
  roots: readonly string[],
  read: Reading,
): Promise<string | null> {
  if (seeded === null || !roots.includes(seeded)) return null
  const tree = await read.tree(seeded).catch(() => null)
  if (!tree) return null
  return (await holdsOnlySeeds(tree, (path) => read.note(path).catch(() => null))) ? seeded : null
}
