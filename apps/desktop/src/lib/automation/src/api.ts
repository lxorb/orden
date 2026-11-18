export type { Road, Said } from './args'
export { said, words, yes } from './args'
export {
  type AgentAnswer,
  answerThreadSpaces,
  type Caller,
  callerOf,
  fullPermissions,
  holds,
  READER,
  refusal,
  threadSpaceOf,
} from './caller'

export const automationStart = () => import('./start')

export const automationActs = () => import('./acts')

export const automationMoving = () => import('./moving')

export { keptFromAgents, NOTE_TREE, NOTE_WRITES } from './front'
