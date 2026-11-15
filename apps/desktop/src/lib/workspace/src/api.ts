export {
  type Entry,
  type Heading,
  type Naming,
  type NewKind,
  type NoteDoc,
  type Space,
  type Tab,
  type TabKind,
  type TreeOptions,
  workspace,
} from './workspace.svelte'
export { mayCarry, pointersMoving, spaceHolding } from './chat-carry'
export { hiddenTabs } from './hidden-tabs.svelte'
export { keptCoverOf, setCoverPosition } from './kept-cover'
export { type HoldsNotes, type Keeping, noteText, replaceInNotes, writeNoteText } from './note-text'
export { isHiddenTabs, ownerOf } from './sets'
export { movingOf, spacesFor } from './space-move'

export const spaceMoving = () => import('./moving-space')

export const spaceSets = () => import('./sets.svelte')

export const fileUndoing = () => import('./undoing')

export const notices = () => import('./notices.svelte')

export const firstVisiting = () => import('./first-visit.svelte')

export const loadUndoToast = () => import('./UndoToast.svelte')
