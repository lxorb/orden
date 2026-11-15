export {
  type Entry,
  type Heading,
  type Naming,
  type NewKind,
  type NoteDoc,
  paletteWords,
  type Space,
  type Tab,
  type TabKind,
  tabOverview,
  toggleTabOverview,
  type TreeOptions,
  workspace,
} from './workspace.svelte'
export { mayCarry, pointersMoving, spaceHolding } from './chat-carry'
export { dropOnList, fileClipboard, listMotion, moving } from './list-landing.svelte'
export { hiddenTabs } from './hidden-tabs.svelte'
export { keptCoverOf, setCoverPosition } from './kept-cover'
export { type HoldsNotes, type Keeping, noteText, replaceInNotes, writeNoteText } from './note-text'
export { isHiddenTabs, ownerOf } from './sets'
export { movingOf, spacesFor } from './space-move'

export const spaceMoving = () => import('./moving-space')

export const spaceSets = () => import('./sets.svelte')

export const spaceChanges = () => import('./space-changes')

export const fileUndoing = () => import('./undoing')

export const notices = () => import('./notices.svelte')

export const firstVisiting = () => import('./first-visit.svelte')

export const loadUndoToast = () => import('./UndoToast.svelte')

export {
  focusEditor,
  focusList,
  intoSide,
  openAgentSession,
  openSpaces,
  revealPanel,
  stepRegionFocus,
} from './focus'

export { hasStatusBar } from './regions'

export {
  followHref,
  followNote,
  followNoteFrom,
  MIDDLE,
  openHref,
  opensLink,
  webHref,
} from './open-link'
