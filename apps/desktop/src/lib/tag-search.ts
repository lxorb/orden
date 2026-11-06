import { search } from './search.svelte'
import { workspace } from './workspace.svelte'

export function searchTag(tag: string): void {
  workspace.showPanel('search')
  search.ask(`tag:${tag}`)
}
