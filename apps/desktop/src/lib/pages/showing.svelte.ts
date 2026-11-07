import { SvelteMap } from 'svelte/reactivity'
import type { PagesStore } from './store.svelte'
import { workspace } from '../workspace.svelte'

class Pages {
  private readonly shown = new SvelteMap<string, PagesStore>()

  get current(): { store: PagesStore } | null {
    const store = this.of(workspace.panelTab?.id)
    return store ? { store } : null
  }

  of(tab: string | null | undefined): PagesStore | null {
    return tab ? (this.shown.get(tab) ?? null) : null
  }

  arrived(tab: string, store: PagesStore) {
    this.shown.set(tab, store)
  }

  gone(tab: string, store: PagesStore) {
    if (this.shown.get(tab) === store) this.shown.delete(tab)
  }
}

export const pages = new Pages()
