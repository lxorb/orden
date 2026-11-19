import type { Entry } from '@orden/contracts'
import { invoke, samePath } from '../../platform/src/api'
import type { Space, TreeOptions } from './workspace.svelte'

export interface FilesOfSpace {
  readonly space: Space
  readonly files: readonly Entry[]
}
interface Holds {
  readonly shownSpaces: Space[]
  readonly activeSpaceId: string | null
  readonly shownFiles: Entry[]
  readonly treeOptions: TreeOptions
  listedIn(tree: Entry): Entry[]
}
export function filesUnder(tree: Entry | null): Entry[] {
  const out: Entry[] = []
  const walk = (entry: Entry) => {
    for (const child of entry.children) {
      if (child.is_dir) walk(child)
      else out.push(child)
    }
  }
  if (tree) walk(tree)
  return out
}
export class SpaceFiles {
  private read = $state.raw<Record<string, { root: string; files: readonly Entry[] }>>({})
  private reading: readonly string[] = []
  constructor(private readonly ws: Holds) {}
  get all(): readonly FilesOfSpace[] {
    return this.ws.shownSpaces.map((space) => ({
      space,
      files: space.id === this.ws.activeSpaceId ? this.ws.shownFiles : this.heldFor(space),
    }))
  }
  want(): void {
    const others = this.ws.shownSpaces.filter((space) => space.id !== this.ws.activeSpaceId)
    const kept = Object.entries(this.read).filter(([id]) => others.some((space) => space.id === id))
    if (kept.length !== Object.keys(this.read).length) this.read = Object.fromEntries(kept)
    for (const space of others) void this.reread(space)
  }
  private heldFor(space: Space): readonly Entry[] {
    const held = this.read[space.id]
    return held && samePath(held.root, space.root) ? held.files : []
  }
  private async reread(space: Space): Promise<void> {
    if (this.reading.includes(space.id)) return
    this.reading = [...this.reading, space.id]
    try {
      const tree = await invoke<Entry>('read_tree', { root: space.root, options: this.ws.treeOptions }).catch(
        () => null,
      )
      this.read = { ...this.read, [space.id]: { root: space.root, files: tree ? this.ws.listedIn(tree) : [] } }
    } finally {
      this.reading = this.reading.filter((id) => id !== space.id)
    }
  }
}
