import { alone } from './alone.svelte'
import { fullscreen } from './fullscreen.svelte'
import { viewport } from './viewport.svelte'

/** Whether a swipe from the edge pulls the panels out: where they are drawers - a phone,
 *  a tablet held upright - and the window is not given over to one note, full screen or
 *  a file opened alone. What the swipe is listened for on (App.svelte), and what makes
 *  the file list's button redundant to an eye (#1066; Titlebar.svelte). */
export function swipeOpens(): boolean {
  return viewport.drawer && !fullscreen.on && !alone.on
}
