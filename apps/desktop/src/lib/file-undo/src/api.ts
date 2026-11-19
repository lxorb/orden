import type { FileActions } from './undo.svelte'

export {
  type Binning,
  type Copied,
  type FileAction,
  FileActions,
  type Kept,
  LANDS_WITHIN,
  type OutsideStep,
  type OutsideTicket,
  sidebarKey,
  used,
} from './undo.svelte'

export const joinLast = async (undone: FileActions): Promise<boolean> => (await import('./undo-join')).joinLast(undone)

export const gatherLast = async (undone: FileActions): Promise<boolean> =>
  (await import('./undo-join')).gatherLast(undone)
