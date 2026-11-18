import { type AgentAnswer, holds } from '../../automation/src/api'
import { helperRun } from '../../ai-chat/src/api'
import { type Mode, modeOfGrant } from '../../ai-providers/src/api'
import type { AgentScope as Scope } from '@orden/contracts'
import { type Call, done, answerOf, Refused } from '../../agent-verbs/src/api'

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
    BUILT_IN.every((one) => holds(call.caller, one)) &&
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
  return { thread, mode, ...(agent ? { reach: agent } : {}) }
}

async function answered(
  ask: (helpers: Awaited<ReturnType<typeof helperRun>>) => Promise<unknown>,
): Promise<AgentAnswer> {
  const said = await ask(await helperRun())
  if (typeof said === 'object' && said !== null && 'refused' in said) {
    const code = 'late' in said && said.late === true ? 'timeout' : 'bad_arguments'
    return answerOf(new Refused(code, String(said.refused)))
  }
  return done(said)
}

export async function runAgent(call: Call): Promise<AgentAnswer> {
  reachesAsFar(call)
  return await answered((helpers) => helpers.runAgent(call.args, askerOf(call), call.deadline))
}

export async function agentResult(call: Call): Promise<AgentAnswer> {
  reachesAsFar(call)
  return await answered((helpers) => helpers.agentResult(call.args, call.deadline))
}
