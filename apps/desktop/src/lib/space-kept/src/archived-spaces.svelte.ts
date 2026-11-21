import { samePath, Kept, stringList } from '../../platform/src/api'

const KEY = 'orden:archived-spaces'
const MOST = 500
export class ArchivedSpaces {
  private keeping: Kept<readonly string[]>
  constructor(heard?: () => void) {
    this.keeping = new Kept(KEY, (saved) => stringList(saved)?.slice(0, MOST) ?? [], heard)
  }
  get roots() {
    return this.keeping.value
  }
  has(root: string): boolean {
    return this.roots.some((one) => samePath(one, root))
  }
  set(root: string, archived: boolean): boolean {
    if (this.has(root) === archived) return false
    this.keeping.value = archived
      ? [...this.roots, root].slice(-MOST)
      : this.roots.filter((one) => !samePath(one, root))
    this.keeping.write()
    return true
  }
}
