import { movedTo } from './platform/src/api'

export class RowIds {
  private readonly ids = new Map<string, string>()
  private count = 0

  idOf(path: string): string {
    const known = this.ids.get(path)
    if (known !== undefined) return known
    const made = `r${String(++this.count)}`
    this.ids.set(path, made)
    return made
  }

  peek(path: string): string | undefined {
    return this.ids.get(path)
  }

  moved(from: string, to: string): void {
    if (from === to) return
    const landed: { path: string; now: string; id: string }[] = []
    for (const [path, id] of this.ids) {
      const now = movedTo(path, from, to)
      if (now !== null) landed.push({ path, now, id })
    }
    for (const one of landed) this.ids.delete(one.path)
    for (const one of landed) this.ids.set(one.now, one.id)
  }

  gone(path: string): void {
    for (const one of [...this.ids.keys()]) {
      if (movedTo(one, path, path) !== null) this.ids.delete(one)
    }
  }
}

export const rowIds = new RowIds()
