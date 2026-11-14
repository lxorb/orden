import type { AgentAnswer } from '../automation/caller'
import { type Mode, modeOfGrant } from '../ai-providers/src/api'
import type { Scope } from '../agents/src/api'
import { type Call, done } from './call'
import { answerOf, Refused } from './problem'

const BUILT_IN: readonly Scope[] = [
  'context',
  'notes.read',
  'notes.write',
  'chats.read',
  'chats.write',
  'tree',
  'workspace',
  'workspace.focus',
  'browser',
  'browser.reader',
  'browser.network',
  'terminal',
  'agents',
]

function reachesAsFar(call: Call): void {
  const agent = call.caller.agent
  if (!agent || agent.builtIn) return

  const whole =
    agent.spaces === 'all' &&
    BUILT_IN.every((one) => agent.scopes.includes(one)) &&
    Object.values(agent.sites).every((rule) => rule === 'allow')
  if (!whole) {
    throw new Refused(
      'not_granted',
      'a helper reaches every space and scope of the built-in agent, and this agent’s grant is narrower',
    )
  }
}

function askerOf(call: Call) {
  const agent = call.caller.agent
  const mode: Mode = agent ? modeOfGrant(agent.mode) : 'auto'
  const thread = 'thread' in call.caller ? (call.caller.thread ?? null) : null
  return { thread, mode }
}

async function answered(
  ask: (helpers: typeof import('../ai/helpers/run')) => Promise<unknown>,
): Promise<AgentAnswer> {
  const said = await ask(await import('../ai/helpers/run'))
  if (typeof said === 'object' && said !== null && 'refused' in said) {
    return answerOf(new Refused('bad_arguments', String(said.refused)))
  }
  return done(said)
}

export async function runAgent(call: Call): Promise<AgentAnswer> {
  reachesAsFar(call)
  return await answered((helpers) => helpers.runAgent(call.args, askerOf(call)))
}

export async function agentResult(call: Call): Promise<AgentAnswer> {
  reachesAsFar(call)
  return await answered((helpers) => helpers.agentResult(call.args))
}
