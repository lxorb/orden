import type { PagesStore } from './store.svelte'

class Pages {
  current = $state.raw<{ store: PagesStore } | null>(null)
  private key: string | null = null

  arrived(key: string, store: PagesStore) {
    this.key = key
    this.current = { store }
  }

  gone(key: string) {
    if (this.key !== key) return

    this.key = null
    this.current = null
  }
}

export const pages = new Pages()
