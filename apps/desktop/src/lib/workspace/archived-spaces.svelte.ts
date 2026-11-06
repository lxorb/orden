import { samePath } from '../space-paths'
import { keepJson, stored, stringList } from '../stored'

const KEY = 'nib:archived-spaces'

const MOST = 500

export class ArchivedSpaces {
  roots = $state.raw<readonly string[]>(stringList(stored(KEY))?.slice(0, MOST) ?? [])

  has(root: string): boolean {
    return this.roots.some((one) => samePath(one, root))
  }

  set(root: string, archived: boolean): boolean {
    if (this.has(root) === archived) return false
    this.roots = archived
      ? [...this.roots, root].slice(-MOST)
      : this.roots.filter((one) => !samePath(one, root))
    keepJson(KEY, this.roots)
    return true
  }
}
