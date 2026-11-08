import { untrack } from 'svelte'
import { gateNote } from './gate-note.svelte'
import { t } from './i18n.svelte'
import { appsOn, chatsOn, explorerOn, passOn, timeOn } from './settings.svelte'
import type { TabKind } from './workspace/tab-kinds'
import { workspace } from './workspace.svelte'

interface Gate {
  on: () => boolean
  kind: TabKind
  name: () => string
}

export function whenOn(
  gate: Gate,
  run: () => void = () => undefined,
  off: () => void = () => undefined,
): void {
  let ran = false
  let was = false
  $effect.root(() => {
    $effect(() => {
      if (!gate.on() || ran) return
      ran = true
      untrack(run)
    })
    $effect(() => {
      const now = gate.on()
      const left = was && !now
      was = now
      if (now) return
      const open = workspace.tabs.filter((one) => one.kind === gate.kind)
      untrack(() => {
        for (const tab of open) workspace.close(tab.id, false)
        if (left) off()
        else if (open.length) gateNote.show(gate.name())
      })
    })
  })
}

export function whenTimeOn(run: () => void): void {
  whenOn({ on: timeOn, kind: 'time', name: () => t('Time tracker') }, run)
}

export function whenPassOn(run: () => void, off: () => void): void {
  whenOn({ on: passOn, kind: 'pass', name: () => t('Password manager') }, run, off)
}

export function whenChatsOn(run: () => void, off: () => void): void {
  whenOn({ on: chatsOn, kind: 'channel', name: () => t('Chats') }, run, off)
  whenOn({ on: chatsOn, kind: 'connect', name: () => t('Chats') })
}

export function whenAppsOn(): void {
  whenOn({ on: appsOn, kind: 'application', name: () => t('Applications') })
}

export function whenExplorerOn(): void {
  whenOn({ on: explorerOn, kind: 'explorer', name: () => t('File explorer') })
}
