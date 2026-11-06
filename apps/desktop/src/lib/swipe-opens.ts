import { alone } from './alone.svelte'
import { fullscreen } from './fullscreen.svelte'
import { viewport } from './viewport.svelte'

export function swipeOpens(): boolean {
  return viewport.drawer && !fullscreen.on && !alone.on
}
