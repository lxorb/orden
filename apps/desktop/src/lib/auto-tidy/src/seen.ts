import { keepJson, recordOf, stored } from '../../platform/src/api'

const KEY = 'orden:auto-tidy-seen'
export const MOST_SEEN = 2000
const when = (one: unknown): one is number => typeof one === 'number' && Number.isFinite(one)
const held = () => Object.entries(recordOf(stored(KEY), when))
class Seen {
  private at = new Map(held())
  read() {
    this.at = new Map(held())
  }
  of(path: string): number | undefined {
    return this.at.get(path)
  }
  stamp(paths: Iterable<string>, now: number) {
    let changed = false
    for (const path of paths) {
      if (this.at.get(path) === now) continue
      this.at.delete(path)
      this.at.set(path, now)
      changed = true
    }
    if (changed) this.write()
  }
  forget(paths: Iterable<string>) {
    let changed = false
    for (const path of paths) changed = this.at.delete(path) || changed
    if (changed) this.write()
  }
  clear() {
    this.at.clear()
    this.write()
  }
  get size(): number {
    return this.at.size
  }
  private write() {
    if (this.at.size > MOST_SEEN) {
      const oldest = [...this.at].sort((one, other) => one[1] - other[1]).slice(0, this.at.size - MOST_SEEN)
      for (const [path] of oldest) this.at.delete(path)
    }
    keepJson(KEY, Object.fromEntries(this.at))
  }
}
export const seen = new Seen()
