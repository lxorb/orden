import { registerAgentTabKind, registerAgentVerbs, registerTabKind } from '@orden/contracts'

const terminal = () => import('../src/lib/terminal/src/api')
const terminalAgent = async () => (await terminal()).terminalAgent()
registerAgentVerbs(async () => (await import('../src/lib/agent-host/src/api')).hostVerbs)
registerAgentVerbs(async () => (await import('../src/lib/explorer/src/api')).explorerVerbs())
registerAgentVerbs(async () => (await import('../src/lib/chats-client/src/api')).chatVerbs())
registerAgentVerbs(async () => (await terminalAgent()).terminalVerbs)
registerAgentVerbs(async () => await (await import('../src/lib/time/src/api')).timeAgentVerbs())
registerAgentTabKind('terminal', async () => (await terminalAgent()).terminalTabs)
registerAgentTabKind('online', async () => (await terminalAgent()).onlineTabs)
registerTabKind('terminal', async () => (await terminal()).terminalTabKind())
