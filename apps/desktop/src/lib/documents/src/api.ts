export {
  type DocumentStart,
  holdsWords,
  NoteDoc,
  opening,
  Tab,
  type TabKind,
  UNTITLED,
  unixLines,
} from './documents.svelte'
export {
  draftFile,
  fileNamed,
  hasWords,
  isDraft,
  isUnsaved,
  offeredName,
  worthAFile,
} from './drafts'
export { type Across, fetchAcross, meetAcross, oweTo, writeEdited, wroteHere } from './in-turn'
export { OpenDocuments, secondWebTabs } from './open'
export { holdsRetiredTab, isRetiredChat, isRetiredTab } from './retired-tabs'
