import { message } from '../i18n.svelte'
import { afterQuiet } from '../timing'
import { isDesktop, joinPath } from '../tauri'
import type { Tab } from '../workspace/documents.svelte'
import { workspace } from '../workspace.svelte'
import {
  CHANGED,
  type Entry,
  type Listing,
  listFolder,
  unwatchFolder,
  watchFolder,
} from './commands'
import { folderName, parentOf } from './crumbs'
import { filtered, ordered } from './order'
import { Search } from './search.svelte'
import {
  type How,
  NOTHING,
  type Picked,
  pickedAll,
  pickedAt,
  pickedOnly,
  stillThere,
} from './picked'
import { places } from './places.svelte'
import { explorerPrefs } from './prefs.svelte'
import { readSpec, type Spec, steppedBack, steppedForward, wentTo, writeSpec } from './spec'
import { samePath } from '../space-paths'

export class ExplorerView {
  readonly tab: Tab
  spec = $state<Spec | null>(null)
  listing = $state.raw<Listing | null>(null)
  wrong = $state<string | null>(null)
  picked = $state<Picked>(NOTHING)
  renaming = $state<string | null>(null)
  renamingMany = $state<string[] | null>(null)
  said = $state<string | null>(null)
  #saying: ReturnType<typeof setTimeout> | undefined

  filter = $state('')
  search = $state<Search | null>(null)

  readonly #sorted = $derived<Entry[]>(
    this.listing ? ordered(this.listing.entries, explorerPrefs.sort, explorerPrefs.hidden) : [],
  )
  readonly rows = $derived<Entry[]>(
    this.search
      ? ordered(this.search.found, explorerPrefs.sort, true)
      : filtered(this.#sorted, this.filter),
  )
  readonly names = $derived(this.rows.map((one) => one.name))

  #watched: string | null = null
  #went = 0
  #landed = 0
  #reread = 0
  #rereading = false
  #again = false
  #alive = false

  constructor(tab: Tab) {
    this.tab = tab
    this.spec = readSpec(tab.doc)
  }

  get folder(): string | null {
    return this.spec?.folder ?? null
  }

  async appear() {
    this.#alive = true
    hearChanges()
    if (this.listing) {
      await this.reload()
      this.watch(this.listing.path)
      return
    }
    const folder = this.folder ?? (await places.home())
    if (folder) await this.show(folder, (listed) => this.spec ?? fresh(listed))
    else this.wrong = message(null, 'could not read this folder')
  }

  async go(folder: string) {
    await this.show(folder, (listed) => (this.spec ? wentTo(this.spec, listed) : fresh(listed)))
  }

  async back() {
    const spec = this.spec && steppedBack(this.spec)
    if (spec) await this.show(spec.folder, () => spec)
  }

  async forward() {
    const spec = this.spec && steppedForward(this.spec)
    if (spec) await this.show(spec.folder, () => spec)
  }

  async up() {
    const here = this.folder
    const above = here ? parentOf(here) : null
    if (!here || !above) return
    await this.go(above)
    const name = folderName(here)
    if (this.names.includes(name)) this.pick(name, 'one')
  }

  async reload() {
    if (this.#rereading) {
      this.#again = true
      return
    }
    this.#rereading = true
    try {
      do {
        this.#again = false
        const began = Date.now()
        await this.#readAgain()
        if (this.#wantsAgain()) await rest(Math.min(Date.now() - began, MOST_REST))
      } while (this.#wantsAgain())
    } finally {
      this.#rereading = false
      this.#again = false
    }
  }

  #wantsAgain(): boolean {
    return this.#again && this.#alive
  }

  async #readAgain() {
    const folder = this.folder
    if (!folder || this.#landed !== this.#went) return
    const went = this.#went
    const reread = ++this.#reread
    const current = () => went === this.#went && reread === this.#reread
    try {
      const listing = await listFolder(folder)
      if (current()) this.take(listing)
    } catch (error) {
      if (current()) this.wrong = message(error, 'could not read this folder')
    }
  }

  get canGoBack(): boolean {
    return (this.spec?.back.length ?? 0) > 0
  }

  get canGoForward(): boolean {
    return (this.spec?.ahead.length ?? 0) > 0
  }

  get canGoUp(): boolean {
    return this.folder !== null && parentOf(this.folder) !== null
  }

  pathOf(name: string): string {
    if (this.search) return joinPath(this.search.root, name)
    const folder = this.listing?.path ?? this.folder ?? ''
    const separator = folder.includes('\\') && !folder.includes('/') ? '\\' : '/'
    return /[\\/]$/.test(folder) ? `${folder}${name}` : `${folder}${separator}${name}`
  }

  pick(name: string, how: How) {
    this.picked = pickedAt(this.picked, this.names, name, how)
  }

  pickNames(names: readonly string[]) {
    this.picked = pickedOnly(names)
  }

  pickAll() {
    this.picked = pickedAll(this.picked, this.names)
  }

  pickNone() {
    this.picked = { ...NOTHING, cursor: this.picked.cursor }
  }

  get chosen(): string[] {
    return this.names.filter((one) => this.picked.names.has(one)).map((one) => this.pathOf(one))
  }

  searchBelow(query: string) {
    const root = this.listing?.path
    if (!root || !query.trim()) return
    this.endSearch()
    const search = new Search(root, query)
    this.search = search
    this.picked = NOTHING
    void search.run(explorerPrefs.hidden)
  }

  endSearch() {
    this.search?.stop()
    if (this.search) this.picked = NOTHING
    this.search = null
  }

  tell(said: string) {
    this.said = said
    clearTimeout(this.#saying)
    this.#saying = setTimeout(() => (this.said = null), SAID_FOR)
  }

  stop() {
    this.#alive = false
    this.#unwatch()
  }

  #unwatch() {
    if (this.#watched) void unwatchFolder(this.#watched)
    this.#watched = null
  }

  private async show(folder: string, next: (listed: string) => Spec) {
    const went = ++this.#went
    let listing: Listing
    try {
      listing = await listFolder(folder)
    } catch (error) {
      if (went !== this.#went) return
      this.#landed = went
      this.wrong = message(error, 'could not read this folder')
      return
    }
    if (went !== this.#went) return
    this.#landed = went
    const moved = !this.listing || !samePath(listing.path, this.listing.path)
    if (moved) {
      this.picked = NOTHING
      this.filter = ''
      this.endSearch()
    }
    this.take(listing)
    this.spec = next(listing.path)
    this.tab.name = folderName(listing.path)
    this.tab.note.replace(writeSpec(this.spec), false)
    workspace.scheduleSession()
    if (this.#alive) this.watch(listing.path)
  }

  private take(listing: Listing) {
    this.wrong = null
    this.listing = listing
    this.picked = stillThere(this.picked, this.names)
  }

  private watch(folder: string) {
    if (this.#watched !== null && samePath(this.#watched, folder)) return
    this.#unwatch()
    this.#watched = folder
    watchFolder(folder).catch(() => undefined)
  }

  heard(folders: readonly string[]) {
    const here = this.listing?.path
    if (here && folders.some((one) => samePath(one, here))) void this.reload()
  }
}

const SAID_FOR = 6000

const MOST_REST = 2000

function rest(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms))
}

function fresh(folder: string): Spec {
  return { folder, back: [], ahead: [] }
}

const views = new WeakMap<Tab, ExplorerView>()

export function viewOf(tab: Tab): ExplorerView {
  let view = views.get(tab)
  if (!view) {
    view = new ExplorerView(tab)
    views.set(tab, view)
  }
  return view
}

export function relistAll() {
  for (const tab of workspace.tabs) {
    if (tab.kind === 'explorer') void views.get(tab)?.reload()
  }
}

let hearing = false
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- held between two events, never drawn
const changed = new Set<string>()
const settle = afterQuiet(() => {
  const folders = [...changed]
  changed.clear()
  for (const tab of workspace.tabs) {
    if (tab.kind === 'explorer') views.get(tab)?.heard(folders)
  }
}, 150)

function hearChanges() {
  if (hearing || !isDesktop) return
  hearing = true
  void import('@tauri-apps/api/event').then(({ listen }) =>
    listen<{ folders: string[] }>(CHANGED, (event) => {
      for (const one of event.payload.folders) changed.add(one)
      settle()
    }),
  )
}
