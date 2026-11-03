/** An event the crate sends to one window, heard in that window alone.
 *
 *  `listen` from the event module registers for Any, and Any hears what was sent to
 *  another window's label too: everything the crate tells a window with `emit_to` reached
 *  every window open, so a verb ran once per window and a key played in all of them. */

import type { Event, UnlistenFn } from '@tauri-apps/api/event'

export async function hearHere<T>(
  event: string,
  then: (event: Event<T>) => void,
): Promise<UnlistenFn> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow().listen<T>(event, then)
}
