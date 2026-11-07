import { untrack } from 'svelte'
import { passOn, timeOn } from './settings.svelte'
import type { TabKind } from './workspace/tab-kinds'
import { workspace } from './workspace.svelte'

export function whenOn(
  on: () => boolean,
  kind: TabKind,
  run: () => void,
  off: () => void = () => undefined,
): void {
  let ran = false
  let was = false
  $effect.root(() => {
    $effect(() => {
      if (!on() || ran) return
      ran = true
      untrack(run)
    })
    $effect(() => {
      const now = on()
      const left = was && !now
      was = now
      if (now) return
      const open = workspace.tabs.filter((one) => one.kind === kind)
      untrack(() => {
        for (const tab of open) workspace.close(tab.id, false)
        if (left) off()
      })
    })
  })
}

export function whenTimeOn(run: () => void): void {
  whenOn(timeOn, 'time', run)
}

export function whenPassOn(run: () => void, off: () => void): void {
  whenOn(passOn, 'pass', run, off)
}
