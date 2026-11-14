export type { Agent } from './presence'
export type { NoteRead } from './read'
export { DocError } from './problem'
export { SCRATCHPAD_TAB, TYPING } from './desk'
export { plan, readEdits, type Replacement } from './edits'
export { revOf } from './rev'
export { touchedBy } from './touched'
export { inTurn } from './turns'

export const agentDocs = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no agent docs in the Even Realities plugin'))
    : import('./index')
