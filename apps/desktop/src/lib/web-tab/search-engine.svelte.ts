import { isRecord, isString, keepJson, stored } from '../stored'
import { SEARCH } from './typed'
import { engineById, engineHome, isEngineAddress } from './engines'

const KEY = 'nib:search-engine'

export const CUSTOM = 'custom'

interface Choice {
  id: string
  custom: string
}

function read(): Choice {
  const kept = stored(KEY)
  if (!isRecord(kept)) return { id: 'google', custom: '' }

  const custom = isString(kept.custom) && isEngineAddress(kept.custom) ? kept.custom.trim() : ''
  const id = isString(kept.id) ? kept.id : 'google'
  if (id === CUSTOM) return custom ? { id, custom } : { id: 'google', custom }
  return { id: engineById(id) ? id : 'google', custom }
}

class SearchEngine {
  private choice = $state<Choice>(read())

  private made = $state(isRecord(stored(KEY)))

  get chosen(): boolean {
    return this.made
  }

  get id(): string {
    return this.choice.id
  }

  get custom(): string {
    return this.choice.custom
  }

  get url(): string {
    if (this.choice.id === CUSTOM) return this.choice.custom || SEARCH
    return engineById(this.choice.id)?.url ?? SEARCH
  }

  get home(): string {
    return engineHome(this.url)
  }

  choose(id: string) {
    if (id === CUSTOM ? !this.choice.custom : !engineById(id)) return
    this.write({ ...this.choice, id })
  }

  setCustom(url: string): boolean {
    if (!isEngineAddress(url)) return false
    this.write({ id: CUSTOM, custom: url.trim() })
    return true
  }

  private write(next: Choice) {
    this.choice = next
    this.made = true
    keepJson(KEY, next)
  }
}

export const searchEngine = new SearchEngine()
