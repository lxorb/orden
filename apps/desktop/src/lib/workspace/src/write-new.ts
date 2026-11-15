import { flushSync } from 'svelte'
import { hiddenKinds } from '../../gates/src/api'
import { views } from '../../panes/src/api'
import { workspace } from './workspace.svelte'

export function writeNew(event: Event) {
  if (event.currentTarget instanceof HTMLElement) event.currentTarget.blur()

  if (!hiddenKinds.offers('note')) {
    workspace.newTab()
    return
  }

  workspace.openBlank()
  flushSync()
  views.of(workspace.panes.focusedId)?.focus()
}
