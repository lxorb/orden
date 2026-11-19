export {
  type Entry,
  type Heading,
  type NewKind,
  type NoteDoc,
  paletteWords,
  type Space,
  type Tab,
  type TabKind,
  tabOverview,
  toggleTabOverview,
  workspace,
} from './workspace.svelte'
export { agentMarks, type TabAct, type Worn } from './agent-marks.svelte'
export { mayCarry, pointersMoving } from './chat-carry'
export { dropOnList, fileClipboard, listMotion, moving } from './list-landing.svelte'
export { hiddenTabs } from './hidden-tabs.svelte'
export { keptCoverOf, setCoverPosition } from './kept-cover'
export { type HoldsNotes, type Keeping, noteText, replaceInNotes, writeNoteText } from './note-text'
export { isHiddenTabs, ownerOf } from './sets'
export { movingOf, spacesFor } from './space-move'
export const spaceMoving = () => import('./moving-space')
export const spaceSets = () => import('./sets.svelte')
export const essentials = () => import('./essentials.svelte')
export const spaceChanges = () => import('./space-changes')
export const fileUndoing = () => import('./undoing')
export const notices = () => import('./notices.svelte')
export const firstVisiting = () => import('./first-visit.svelte')
export const loadUndoToast = () => import('./UndoToast.svelte')
export { focusEditor, focusList, intoSide, openAgentSession, openSpaces, revealPanel, stepRegionFocus } from './focus'
export { hasStatusBar } from './regions'
export { followHref, followNote, followNoteFrom, MIDDLE, openHref, opensLink, webHref } from './open-link'
export { alone, swipeOpens } from './alone.svelte'
export { claimsGesture, drawer, isFinger, rightDrawer } from './drawer.svelte'
export const drawerFollowing = () => import('./drawer-follow')
export { writeNew } from './write-new'
export { onTwist, treeStep, TREE_MOVES } from './tree-keys'
export { scratchpadOn } from './services'
export type { Across } from './across'
export const acrossStarting = () => import('./across')
export const blankTabs = () => import('./blank-tabs.svelte')
export const outsideHearing = () => import('./outside.svelte')
export { howFor, linkAsk, middleOpens, type Press, type TabAsk, tabAsk } from './new-tab'
export { carvable, mergeable } from './composing'
export { accountAddress, storeAttachment, storeBeside, storeImage } from './assets'
export { pull, pullable, REACH } from './pull.svelte'
export const paneMoves = () => import('./pane-moves')
export const noteCovers = () => import('./note-cover')
export const featureGates = () => import('./feature-gate.svelte')
export const refreshing = () => import('./refresh')
export const closing = () => import('./closing')
