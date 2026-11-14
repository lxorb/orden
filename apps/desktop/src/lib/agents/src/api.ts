export type { Agent } from './docs/presence'
export type { NoteRead } from './docs/read'
export { DocError } from './docs/problem'
export { SCRATCHPAD_TAB, TYPING } from './docs/desk'
export { plan, readEdits, type Replacement } from './docs/edits'
export { revOf } from './docs/rev'
export { touchedBy } from './docs/touched'
export { type McpClient, mcpLine } from './mcp'
export { default as AgentMark } from './settings/AgentMark.svelte'
export { tauriCrate } from './settings/crate'
export { AgentsPane } from './settings/pane.svelte'
export { reach } from './settings/reach.svelte'
export { inTurn } from './turns'
export { asking } from './ui/asking.svelte'
export { ACTIVE_FOR } from './ui/marks'
export { default as Spark } from './ui/Spark.svelte'
export {
  AGENT_WINDOW_VERBS,
  CAPTURE_AS,
  type CaptureAs,
  type Category,
  type Code,
  type Overview,
  type ReaderTab,
  type Scope,
  type StoreSaid,
} from './verbs'

export const agentsUi = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no agents in the Even Realities plugin'))
    : import('./ui/index')

export const agentDocs = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no agent docs in the Even Realities plugin'))
    : import('./docs/index')

export const loadAgentDetail = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no agent settings in the Even Realities plugin'))
    : import('./settings/AgentDetail.svelte')

export const agentStandIn = () => import('./settings/fake')

export const loadAgentRows = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no agents in the Even Realities plugin'))
    : import('./ui/AgentRows.svelte')

export const loadAgentSession = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no agents in the Even Realities plugin'))
    : import('./ui/AgentSession.svelte')

export const loadTakeoverBar = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no agents in the Even Realities plugin'))
    : import('./ui/TakeoverBar.svelte')
