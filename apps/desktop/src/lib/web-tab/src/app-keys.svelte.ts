import { offeredHere, SHORTCUTS, shortcuts } from '../../shortcuts/src/api'
import { invoke, isDesktop } from '../../platform/src/api'
import { appKeys } from './keys'

let handing = false
export function handAppKeys(): void {
  if (handing || !isDesktop) return
  handing = true
  $effect.root(() => {
    $effect(() => {
      const keys = appKeys(SHORTCUTS, (id) => shortcuts.keyFor(id), offeredHere, shortcuts.platform)
      void invoke('web_keys_app', { keys }).catch(() => undefined)
    })
  })
}
