import './shell-parts'
export { tauriCrate } from './settings/crate'
export { asking } from './ui/asking.svelte'
export { default as Spark } from './ui/Spark.svelte'
export const agentsUi = () => import('./ui/index')
export const agentStandIn = () => import('./settings/fake')
export const loadAgentRows = () => import('./ui/AgentRows.svelte')
export const loadAgentSession = () => import('./ui/AgentSession.svelte')
export const loadTakeoverBar = () => import('./ui/TakeoverBar.svelte')
