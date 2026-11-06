import { forget, keepJson, stored, stringList } from './stored'

const RECENT_KEY = 'nib:icons-recent'

const OLD_SET_KEY = 'nib:icon-set'
forget(OLD_SET_KEY)

const MOST_RECENT = 12

class IconRecent {
  list = $state<string[]>(stringList(stored(RECENT_KEY))?.slice(0, MOST_RECENT) ?? [])

  add(value: string | null) {
    if (!value) return

    this.list = [value, ...this.list.filter((one) => one !== value)].slice(0, MOST_RECENT)
    keepJson(RECENT_KEY, this.list)
  }
}

export const iconRecent = new IconRecent()
