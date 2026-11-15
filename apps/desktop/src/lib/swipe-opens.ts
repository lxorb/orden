import { alone } from './alone.svelte'
import { fullscreen } from './platform/src/api'
import { viewport } from './ui-kit/src/api'

export function swipeOpens(): boolean {
  return viewport.drawer && !fullscreen.on && !alone.on
}
