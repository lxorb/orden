import { isRecord, keepJson, stored } from '../stored'
import type { Sort, SortKey } from './order'

const KEY = 'nib:explorer'

const SORT_KEYS: readonly SortKey[] = ['name', 'modified', 'size', 'kind']

class ExplorerPrefs {
  sort = $state<Sort>({ key: 'name', down: false })
  hidden = $state(false)
  places = $state(true)

  constructor() {
    const kept = stored(KEY)
    if (!isRecord(kept)) return
    if (isRecord(kept.sort) && SORT_KEYS.includes(kept.sort.key as SortKey))
      this.sort = { key: kept.sort.key as SortKey, down: kept.sort.down === true }
    this.hidden = kept.hidden === true
    this.places = kept.places !== false
  }

  sortBy(key: SortKey) {
    this.sort = { key, down: this.sort.key === key ? !this.sort.down : key !== 'name' }
    this.keep()
  }

  toggleHidden() {
    this.hidden = !this.hidden
    this.keep()
  }

  togglePlaces() {
    this.places = !this.places
    this.keep()
  }

  private keep() {
    keepJson(KEY, { sort: this.sort, hidden: this.hidden, places: this.places })
  }
}

export const explorerPrefs = new ExplorerPrefs()
