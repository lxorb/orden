/** `run_agent` and `agent_result` for an agent that reaches Orden through `nib mcp`: the
 *  AI panel's own Claude Code and Codex, and an agent the reader runs outside Orden. The
 *  helpers themselves are lib/ai/helpers', fetched with the first call; this only reads
 *  who asked and says the answer the contract's way.
 *
 *  A panel session says which thread it runs for, so its helper works in that thread's
 *  mode and is stopped with it. An outside agent has no thread: its helper works as its
 *  grant supervises it - asking first where the grant asks, never where it does not.
 *
 *  A helper's calls run as the provider's built-in grant (src-tauri/src/ai_agent.rs), which
 *  reaches every space and the terminal, and nothing carries the asker's reach across
 *  that. So an outside agent is lent one only when its own grant reaches at least as far;
 *  one narrowed in Settings > Agents is refused, or a helper would be the way round each
 *  thing it was narrowed by. */

import type { AgentAnswer } from '../../automation/caller'
import { type Mode, modeOfGrant } from '../../ai/modes'
import type { Scope } from '../verbs'
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

/** Who asked, as the helpers read it. */
function askerOf(call: Call) {
  const agent = call.caller.agent
  const mode: Mode = agent ? modeOfGrant(agent.mode) : 'auto'
  const thread = 'thread' in call.caller ? (call.caller.thread ?? null) : null
  return { thread, mode }
}

async function answered(
  ask: (helpers: typeof import('../../ai/helpers/run')) => Promise<unknown>,
): Promise<AgentAnswer> {
  const said = await ask(await import('../../ai/helpers/run'))
  if (typeof said === 'object' && said !== null && 'refused' in said) {
    return answerOf(new Refused('bad_arguments', String(said.refused)))
  }
  return done(said)
}

/** `run_agent`: a helper started on another model. */
export async function runAgent(call: Call): Promise<AgentAnswer> {
  reachesAsFar(call)
  return await answered((helpers) => helpers.runAgent(call.args, askerOf(call)))
}

/** `agent_result`: where a helper stands. */
export async function agentResult(call: Call): Promise<AgentAnswer> {
  reachesAsFar(call)
  return await answered((helpers) => helpers.agentResult(call.args))
}
