import { isRecord, keepJson, stored } from '../stored'
import type { Sort, SortKey } from './order'

const KEY = 'orden:explorer'

const SORT_KEYS: readonly SortKey[] = ['name', 'modified', 'size', 'kind']

type View = 'list' | 'grid' | 'columns'

class ExplorerPrefs {
  sort = $state<Sort>({ key: 'name', down: false })
  hidden = $state(false)
  places = $state(true)
  view = $state<View>('list')
  preview = $state(false)

  constructor() {
    const kept = stored(KEY)
    if (!isRecord(kept)) return
    if (isRecord(kept.sort) && SORT_KEYS.includes(kept.sort.key as SortKey))
      this.sort = { key: kept.sort.key as SortKey, down: kept.sort.down === true }
    this.hidden = kept.hidden === true
    this.places = kept.places !== false
    this.view = kept.view === 'grid' || kept.view === 'columns' ? kept.view : 'list'
    this.preview = kept.preview === true
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

  togglePreview() {
    this.preview = !this.preview
    this.keep()
  }

  show(view: View) {
    this.view = view
    this.keep()
  }

  private keep() {
    keepJson(KEY, {
      sort: this.sort,
      hidden: this.hidden,
      places: this.places,
      view: this.view,
      preview: this.preview,
    })
  }
}

export const explorerPrefs = new ExplorerPrefs()
