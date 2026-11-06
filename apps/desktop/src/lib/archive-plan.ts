import { coveredBy } from './workspace/archive.svelte'

function under(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`)
}

export function toArchive(paths: readonly string[], keys: ReadonlySet<string>): string[] {
  const fresh = [...new Set(paths)].filter((path) => path && coveredBy(keys, path) === null)
  return fresh.filter((path) => !fresh.some((other) => other !== path && under(path, other)))
}

export function standing(keys: ReadonlySet<string>): string[] {
  return [...keys].filter((path) => {
    const cut = path.lastIndexOf('/')
    return cut === -1 || coveredBy(keys, path.slice(0, cut)) === null
  })
}

export function toRestore(
  keys: ReadonlySet<string>,
  at: string,
  childrenOf: (folder: string) => readonly string[],
): { restore: string[]; archive: string[] } {
  const chain: string[] = []
  for (let path = at; ;) {
    chain.unshift(path)
    const cut = path.lastIndexOf('/')
    if (cut === -1) break
    path = path.slice(0, cut)
  }

  const restore = chain.filter((path) => keys.has(path))
  const outer = restore[0]
  if (outer === undefined) return { restore: [], archive: [] }

  const archive: string[] = []
  for (const folder of chain.slice(chain.indexOf(outer), -1)) {
    for (const child of childrenOf(folder)) {
      if (!chain.includes(child) && !keys.has(child)) archive.push(child)
    }
  }

  return { restore, archive }
}
