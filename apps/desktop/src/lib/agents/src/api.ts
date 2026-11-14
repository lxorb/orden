import './shell-parts'
export { tauriCrate } from './settings/crate'
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
