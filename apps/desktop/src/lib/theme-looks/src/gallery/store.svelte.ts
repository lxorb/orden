import { message } from '../../../ui-kit/src/api'
import { log, keepJson, stored, stringList, invoke } from '../../../platform/src/api'
import { isBuiltIn, theme, stamped } from '../../../theme/src/api'
import { indexUrl, isNewer, readIndex, type StoreTheme, styleUrl } from './registry'
import { review } from './validate'

type Order = 'newest' | 'name'

const FRESH_FOR = 5 * 60 * 1000

export const PAINT = 'orden:themes'

export const GIVEN_THEMES = ['graphite', 'rose', 'warm-paper'] as const

const GIVEN_KEY = 'orden:themes-given'

function matches(one: StoreTheme, needle: string): boolean {
  return [one.name, one.author, one.description, ...one.tags].some((text) =>
    text.toLowerCase().includes(needle),
  )
}

export function arrange(themes: StoreTheme[], query: string, order: Order): StoreTheme[] {
  const needle = query.trim().toLowerCase()
  const shown = needle ? themes.filter((one) => matches(one, needle)) : [...themes]

  return shown.sort((a, b) =>
    order === 'name'
      ? a.name.localeCompare(b.name)
      : b.updated.localeCompare(a.updated) || a.name.localeCompare(b.name),
  )
}

class Store {
  open = $state(false)
  query = $state('')
  order = $state<Order>('newest')
  opened = $state<string | null>(null)

  themes = $state<StoreTheme[]>([])
  loading = $state(false)
  error = $state<string | null>(null)
  refused = $state<{ id: string; notes: string[] }>({ id: '', notes: [] })
  working = $state<string | null>(null)

  private fetchedAt = 0

  readonly shown = $derived(arrange(this.themes, this.query, this.order))
  readonly chosen = $derived(this.themes.find((one) => one.id === this.opened) ?? null)

  installed(id: string): boolean {
    return theme.installed.has(id)
  }

  updatable(one: StoreTheme): boolean {
    const held = theme.installed.get(one.id)?.stamp?.version
    return held !== undefined && isNewer(one.version, held)
  }

  using(id: string): boolean {
    return theme.active.stamp?.id === id
  }

  show() {
    this.open = true
    this.opened = null
    this.error = null
    void this.load()
  }

  close() {
    this.open = false
    this.query = ''
    this.opened = null
    this.error = null
    this.refused = { id: '', notes: [] }
  }

  async load(force = false) {
    if (!force && this.themes.length && Date.now() - this.fetchedAt < FRESH_FOR) return

    this.loading = true
    this.error = null

    try {
      const response = await fetch(indexUrl(), { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error('could not reach the theme store')

      const body: unknown = await response.json()
      performance.clearMarks(`${PAINT}:index`)
      performance.mark(`${PAINT}:index`)

      this.themes = readIndex(body).filter((one) => !isBuiltIn(one.id))
      this.fetchedAt = Date.now()
    } catch (error) {
      this.error = message(error, 'could not reach the theme store')
    } finally {
      this.loading = false
    }
  }

  async install(one: StoreTheme) {
    this.working = one.id
    this.error = null
    this.refused = { id: one.id, notes: [] }

    try {
      const refused = await this.write(one)
      this.refused = { id: one.id, notes: refused }

      await theme.reload()
      this.use(one.id)
    } catch (error) {
      this.error = message(error, 'could not install that theme')
    } finally {
      this.working = null
    }
  }

  private async write(one: StoreTheme): Promise<string[]> {
    const response = await fetch(styleUrl(one.id))
    if (!response.ok) throw new Error('could not fetch that theme')

    const reviewed = review(await response.text())
    if (!reviewed.css) throw new Error('that theme has nothing a theme may set')

    if (reviewed.refused.length) {
      log('warn', `${one.id} ${one.version}: ${reviewed.refused.join('; ')}`)
    }

    await invoke<string>('write_theme', {
      id: one.id,
      css: stamped(
        { id: one.id, name: one.name, author: one.author, version: one.version },
        reviewed.css,
      ),
    })
    return reviewed.refused
  }

  async keepUp() {
    await theme.reload()
    await this.load()
    if (this.error) {
      log('warn', `themes: could not keep up: ${this.error}`)
      this.error = null
      return
    }

    const given = [...(stringList(stored(GIVEN_KEY)) ?? [])]
    let wrote = false
    for (const one of this.themes) {
      const owed = GIVEN_THEMES.some((id) => id === one.id) && !given.includes(one.id)
      if (!this.updatable(one) && !(owed && !this.installed(one.id))) {
        if (owed) given.push(one.id)
        continue
      }
      if (this.working === one.id) continue
      try {
        await this.write(one)
        wrote = true
        if (owed) given.push(one.id)
      } catch (error) {
        log('warn', `themes: could not keep ${one.id} up: ${String(error)}`)
      }
    }

    keepJson(GIVEN_KEY, given)
    if (wrote) await theme.reload()
  }

  use(id: string) {
    const file = theme.installed.get(id)
    if (file) theme.select(file.id)
  }

  async remove(id: string) {
    this.working = id
    this.error = null

    try {
      await invoke('remove_theme', { id })
      await theme.reload()
    } catch (error) {
      this.error = message(error, 'could not remove that theme')
    } finally {
      this.working = null
    }
  }

  action(one: StoreTheme): string {
    if (this.updatable(one)) return 'Update'
    if (this.using(one.id)) return 'In use'
    if (this.installed(one.id)) return 'Use'
    return 'Install'
  }
}

export const store = new Store()
