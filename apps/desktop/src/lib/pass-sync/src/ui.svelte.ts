import type { Flag } from '@orden/pass/monitor'
import type { Content, Item } from '@orden/pass/types'
import { prompt } from '../../ui-kit/src/api'
import type { Tab } from '../../workspace/documents.svelte'
import type { Scope } from './list'
import { pass } from './store.svelte'
import { type Page, type PassView, type SettingsTab, viewIn, writeView } from './view'

export type Column = 'side' | 'list' | 'item'

export interface Editing {
  id: string | null
  content: Content
  vault: string
  folder: string | null
}

export type PassSheet =
  | { kind: 'vault'; vault: string | null }
  | { kind: 'move'; ids: string[] }
  | { kind: 'history'; item: string }
  | { kind: 'generator'; use: ((password: string) => void) | null }
  | { kind: 'share'; vault: string }
  | { kind: 'link'; item: string }
  | { kind: 'adopt' }
  | null

export class PassUi {
  view = $state.raw<PassView>(viewIn(''))
  query = $state('')
  editing = $state<Editing | null>(null)
  dirty = $state(false)
  sheet = $state.raw<PassSheet>(null)
  picked = $state.raw<string[] | null>(null)
  column = $state<Column>('list')
  flag = $state<Flag | null>(null)
  flagged = $state.raw<string[]>([])
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- replaced whole after each check, never changed in place
  compromised = $state.raw<ReadonlySet<string>>(new Set())
  searchField: HTMLInputElement | null = null

  private readonly tab: Tab | null

  constructor(tab: Tab | null) {
    this.tab = tab
    this.view = viewIn(tab?.doc ?? '')
    if (this.view.item !== null) this.column = 'item'
  }

  get shownItem(): Item | null {
    const id = this.view.item
    return id === null ? null : (pass.items.find((one) => one.id === id) ?? null)
  }

  show(change: Partial<PassView>): void {
    this.view = { ...this.view, ...change }
    this.tab?.note.replace(writeView(this.view), false)
  }

  async leave(): Promise<boolean> {
    if (this.editing && this.dirty) {
      const sure = await prompt.confirm({
        until: pass.opened,
        title: 'Discard your changes?',
        confirmLabel: 'Discard',
        danger: true,
      })
      if (!sure) return false
    }
    this.editing = null
    this.dirty = false
    return true
  }

  async choose(scope: Scope): Promise<void> {
    if (!(await this.leave())) return
    this.flag = null
    this.picked = null
    this.show({ scope, page: 'items', item: null })
    this.column = 'list'
  }

  async goTo(page: Page, settingsTab?: SettingsTab): Promise<void> {
    if (!(await this.leave())) return
    this.flag = null
    this.picked = null
    this.show({ page, item: null, ...(settingsTab ? { settingsTab } : {}) })
    this.column = 'list'
  }

  async openItem(id: string): Promise<void> {
    if (this.editing?.id === id) return
    if (!(await this.leave())) return
    this.show({ item: id })
    this.column = 'item'
  }

  async newItem(content: Content): Promise<void> {
    if (!(await this.leave())) return
    const scope = this.view.scope
    this.editing = {
      id: null,
      content,
      vault: this.defaultVault(),
      folder: scope.kind === 'vault' ? scope.folder : null,
    }
    this.column = 'item'
  }

  async edit(id: string): Promise<void> {
    const item = pass.items.find((one) => one.id === id)
    if (!item || !(await this.leave())) return
    this.editing = {
      id,
      content: structuredClone(item.content),
      vault: item.vault,
      folder: item.folder,
    }
    this.show({ item: id })
    this.column = 'item'
  }

  edited(item: Item | null): void {
    this.editing = null
    this.dirty = false
    if (item) this.show({ item: item.id, page: 'items' })
    else if (this.view.item === null) this.column = 'list'
  }

  back(): void {
    if (this.column === 'item') {
      void this.leave().then((left) => {
        if (left) this.column = 'list'
      })
    } else this.column = 'side'
  }

  defaultVault(): string {
    const scope = this.view.scope
    const vaults = pass.vaults
    if (scope.kind === 'vault' && vaults.some((one) => one.id === scope.vault)) return scope.vault
    const chosen = pass.settings.defaultVault
    if (chosen !== null && vaults.some((one) => one.id === chosen)) return chosen
    return vaults[0]?.id ?? ''
  }
}
