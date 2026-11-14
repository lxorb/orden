import { invoke } from '../platform/src/api'
import type { Page } from './pages.svelte'

export type Sought = 'find' | 'next' | 'previous'

export function seek(tab: string, page: Page, query: string, look: 'fresh' | 'next' | 'previous') {
  page.find.query = query
  if (!query) {
    page.find.count = 0
    page.find.at = -1
    void invoke('web_find_stop', { tab }).catch(() => undefined)
    return
  }
  void invoke('web_find', { tab, term: query, look }).catch(() => undefined)
}

export function shut(tab: string, page: Page) {
  page.find.open = false
  void invoke('web_find_stop', { tab }).catch(() => undefined)
  void invoke('keyboard_back', { tab }).catch(() => undefined)
}

export function sought(tab: string, page: Page, look: Sought) {
  if (look === 'find' || !page.find.open) {
    page.find.open = true
    return
  }
  seek(tab, page, page.find.query, look)
}
