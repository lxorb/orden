import type { Event, UnlistenFn } from '@tauri-apps/api/event'

export async function hearHere<T>(
  event: string,
  then: (event: Event<T>) => void,
): Promise<UnlistenFn> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow().listen<T>(event, then)
}
