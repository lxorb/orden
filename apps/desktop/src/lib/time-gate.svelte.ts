import { untrack } from 'svelte'
import { timeOn } from './settings.svelte'
import { workspace } from './workspace.svelte'

export function whenTimeOn(run: () => void): void {
  let ran = false
  $effect.root(() => {
    $effect(() => {
      if (!timeOn() || ran) return
      ran = true
      untrack(run)
    })
    $effect(() => {
      if (timeOn()) return
      const open = workspace.tabs.filter((one) => one.kind === 'time')
      untrack(() => {
        for (const tab of open) workspace.close(tab.id, false)
      })
    })
  })
}
