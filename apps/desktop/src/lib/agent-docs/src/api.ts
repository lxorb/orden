export type { Agent } from './presence'
export type { NoteRead } from './read'
export { taskIn } from './anchors'
export { DocError } from './problem'
export { SCRATCHPAD_TAB, TYPING } from './desk'
export { plan, readEdits, type Replacement } from './edits'
export { revOf } from './rev'
export { touchedBy } from './touched'
export { undoRows } from './undo-rows'
export { inTurn, startsBefore } from './turns'

export const agentDocs = () =>
  __EVEN_PLUGIN__ ? Promise.reject(new Error('no agent docs in the Even Realities plugin')) : import('./index')
