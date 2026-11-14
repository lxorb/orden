import { workspace } from '../../workspace.svelte'

export function openPrivate(): void {
  workspace.openWebsite(true)
}
