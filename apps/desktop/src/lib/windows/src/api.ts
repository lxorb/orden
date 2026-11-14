import type { Event, UnlistenFn } from '@tauri-apps/api/event'
export {
  autoScrollBy,
  type Fold,
  heightOf,
  indexAt,
  listHeight,
  offsetOf,
  type Place,
  type Rows,
  type RowWindow,
  scrollerOf,
  slotsFor,
  windowFor,
} from './row-window'
export { ListView, measuredRow, tokenFloor, tokenRow } from './row-window.svelte'
export type { Showing, WindowDocument } from './window-document'
export { type Resizable, WindowState } from './window-state.svelte'

export const windowDocuments = () => import('./window-document')

export async function hearHere<T>(
  event: string,
  then: (event: Event<T>) => void,
): Promise<UnlistenFn> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow().listen<T>(event, then)
}
