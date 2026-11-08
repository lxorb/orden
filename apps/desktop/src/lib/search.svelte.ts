import { SvelteSet } from 'svelte/reactivity'
import type { EditorView } from '@orden/editor'
import { revealPanel } from './focus'
import { isScratchpad } from './scratchpad/is.svelte'
import type { Hit } from '@orden/scan/search/match'
import { isEmpty, parseQuery } from '@orden/scan/search/query'
import { selectedWords } from './search/seed'
import { searchSpace } from './search/space'
import { isMarkdownPath } from './space-paths'
import { isBoolean, isRecord, keepJson, stored } from './stored'
import { afterQuiet } from './timing'
import { workspace } from './workspace.svelte'

const WAIT = 140

const MOST = 200

const SHORTEST = 2

const keyOf = (hit: Hit) => `${hit.path}:${hit.line}`

export type SearchSort = 'relevance' | 'name' | 'modified' | 'created'

const SORT_KEY = 'orden:search-sort'

interface Ordering {
  sort: SearchSort
  descending: boolean
}

const AS_ASKED: Ordering = { sort: 'relevance', descending: false }

const SORTS: readonly SearchSort[] = ['relevance', 'name', 'modified', 'created']

function readOrdering(): Ordering {
  const saved = stored(SORT_KEY)
  if (!isRecord(saved)) return { ...AS_ASKED }

  const sort = SORTS.find((one) => one === saved.sort)
  return {
    sort: sort ?? AS_ASKED.sort,
    descending: isBoolean(saved.descending) ? saved.descending : false,
  }
}

class Search {
  text = $state('')
  found = $state<Hit[]>([])
  loose = $state<Hit[]>([])
  running = $state(false)
  replacing = $state(false)
  replacement = $state('')
  archived = $state(false)

  private readonly skipped = new SvelteSet<string>()

  private readonly asking = afterQuiet(() => void this.run(), WAIT)
  private round = 0
  private about: string | null = null

  readonly query = $derived(parseQuery(this.text))
  readonly asks = $derived(this.text.trim().length >= SHORTEST && !isEmpty(this.query))

  private readonly open = $derived(
    workspace.protection.any ? (hit: Hit) => !workspace.protection.locked(hit.path) : () => true,
  )

  readonly hits = $derived(
    [...this.inOrder(this.found), ...this.inOrder(this.loose)].filter(this.open),
  )

  ordering = $state<Ordering>(readOrdering())

  private readonly dated = $derived.by(() => new Map(workspace.files.map((one) => [one.path, one])))

  showArchived(shown: boolean) {
    if (this.archived === shown) return

    this.archived = shown
    if (this.asks) void this.run()
  }

  setSort(sort: SearchSort) {
    const descending = this.ordering.sort === sort ? !this.ordering.descending : false
    this.ordering = { sort, descending }
    keepJson(SORT_KEY, this.ordering)
  }

  private inOrder<T extends Hit>(hits: readonly T[]): T[] {
    const { sort, descending } = this.ordering
    if (sort === 'relevance') return [...hits]

    const dated = this.dated
    const at = (hit: Hit) => {
      if (sort === 'name') return 0
      const entry = dated.get(hit.path)
      return (sort === 'modified' ? entry?.modified : entry?.created) ?? 0
    }

    const way = descending ? -1 : 1
    return [...hits].sort((one, other) => {
      const first =
        sort === 'name'
          ? one.name.localeCompare(other.name, undefined, { sensitivity: 'base' })
          : at(one) - at(other)

      return first * way || one.path.localeCompare(other.path) || one.line - other.line
    })
  }

  readonly chosen = $derived(
    this.found.filter(
      (hit) =>
        this.open(hit) &&
        hit.tab === undefined &&
        !hit.bare &&
        isMarkdownPath(hit.path) &&
        !isScratchpad(hit.path) &&
        !this.skipped.has(keyOf(hit)),
    ),
  )

  keeps(hit: Hit): boolean {
    return !hit.bare && !this.skipped.has(keyOf(hit))
  }

  toggle(hit: Hit) {
    const key = keyOf(hit)
    if (this.skipped.has(key)) this.skipped.delete(key)
    else this.skipped.add(key)
  }

  ask(text: string) {
    this.text = text
    this.about = workspace.activeSpace?.root ?? null
    this.asking.cancel()
    this.round++

    if (!this.asks) {
      this.empty()
      this.running = false
      return
    }

    this.running = true
    this.asking()
  }

  toggleReplace() {
    this.replacing = !this.replacing
    if (!this.replacing) this.skipped.clear()
  }

  closeReplace() {
    if (!this.replacing) return

    this.replacing = false
    this.skipped.clear()
  }

  clear() {
    this.asking.cancel()
    this.round++
    this.text = ''
    this.about = null
    this.empty()
    this.running = false
    this.skipped.clear()
  }

  private empty() {
    this.found = []
    this.loose = []
  }

  forSpace(root: string | null) {
    if (this.about !== root) this.clear()
  }

  private async run() {
    const round = this.round
    const root = workspace.activeSpace?.root

    if (!root) {
      this.running = false
      return
    }

    this.empty()
    this.skipped.clear()

    const { fuzzyTerms } = await import('@orden/scan/search/fuzzy')
    const terms = this.replacing ? [] : fuzzyTerms(this.query)

    const excluded = [
      ...(this.archived ? workspace.excluded.of(root) : workspace.leftOutOf(root)),
      workspace.instructionsName(root),
    ]
    const { unsavedHits } = await import('./search/unsaved')
    const unsaved = unsavedHits(this.query, workspace.activeSpaceId, MOST)
    const pad =
      this.replacing || __EVEN_PLUGIN__
        ? []
        : await import('./search/scratchpad').then((one) => one.scratchpadHits(this.query, MOST))
    if (round === this.round && (unsaved.length || pad.length)) this.found = [...unsaved, ...pad]
    await searchSpace(
      root,
      this.query,
      terms,
      MOST,
      (batch) => {
        if (round !== this.round) return

        if (batch.hits.length) this.found = [...this.found, ...batch.hits]
        if (batch.loose.length) this.loose = [...this.loose, ...batch.loose]
      },
      excluded,
    )

    if (round === this.round) this.running = false
  }

  async replace() {
    const root = workspace.activeSpace?.root
    const chosen = this.chosen
    if (!root || !chosen.length) return

    const { changesFor } = await import('./search/apply')
    const changes = await changesFor(this.query, chosen, this.replacement, root, (path) =>
      workspace.noteText(path),
    )

    await workspace.replaceInNotes(changes)

    this.round++
    await this.run()
  }
}

export const search = new Search()

export function searchFrom(view: EditorView | undefined): void {
  const words = view?.hasFocus ? selectedWords(view.state) : null
  if (words) search.ask(words)

  revealPanel('search')
}
