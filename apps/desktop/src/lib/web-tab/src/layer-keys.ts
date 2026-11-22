import { takeKeyboard } from '../../platform/src/api'
import { overlays } from '../../ui-kit/src/api'

let stop: (() => unknown) | null = null
let users = 0
let open = 0
export function keysFollowLayers(): () => void {
  users += 1
  if (stop === null) {
    open = overlays.layers
    stop = overlays.watch(() => {
      const now = overlays.layers
      if (now > open && !document.hasFocus()) void takeKeyboard()
      open = now
    })
  }
  return () => {
    users -= 1
    if (users > 0 || stop === null) return
    stop()
    stop = null
  }
}
