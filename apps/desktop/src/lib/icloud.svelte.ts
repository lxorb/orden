import { SvelteSet } from 'svelte/reactivity'
import { isDesktop } from './platform/src/api'

interface Fetching {
  path: string
  done: boolean
}

const EVENT = 'orden://icloud'

class ICloud {
  readonly coming = new SvelteSet<string>()
  private listening = false

  listen() {
    if (this.listening || !isDesktop) return
    this.listening = true

    void import('@tauri-apps/api/event').then(({ listen }) =>
      listen<Fetching>(EVENT, (event) => this.heard(event.payload)),
    )
  }

  heard(one: Fetching) {
    if (!one.done) {
      this.coming.add(one.path)
      return
    }

    this.coming.delete(one.path)
    void import('./workspace.svelte').then(({ workspace }) => workspace.loadTree())
  }
}

export const icloud = new ICloud()
