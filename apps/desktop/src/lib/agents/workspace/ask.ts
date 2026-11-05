/** A question put to the reader: `ask_reader` (docs/agent-native.md 8.14, #1078), the
 *  way a VS Code extension's `window.showInformationMessage`, `showQuickPick` and
 *  `showInputBox` put one.
 *
 *  Its own scope, `ask`, which the reader's own agents hold and a third party is granted.
 *  A `notice` is told as a notification and answered at once; a `choice` or a `text` is
 *  shown in the agent's session in the Ask panel (#1120), told once as a notification
 *  that opens it, and
 *  waited for up to `wait_ms`. An agent not answered in that time is given the question's
 *  id, and asks again with it. Only an agent the reader is talking to asks at all: one
 *  the reader stopped is refused before this is reached, and its questions are taken back.
 *  What the reader typed is the reader's own words, so it is not marked as anybody else's. */

import type { AgentAnswer } from '../../automation/caller'
import { t } from '../../i18n.svelte'
import { show } from '../../notify'
import { agentOpen } from '../../ai/sidebar/agent-open.svelte'
import { revealPanel } from '../../focus'
import { asking } from '../ui/asking.svelte'
import { type Call, count, done, maybe, need } from './call'
import { Refused } from './problem'

/** How long an answer is waited for when the agent does not say, and at the most:
 *  inside the time `nib mcp` waits for an answer. */
const WAIT = 60_000
const MOST_WAIT = 120_000

/** The most choices a question offers, and the longest message. */
const MOST_CHOICES = 12
const MOST_MESSAGE = 2000

export async function askReader(call: Call): Promise<AgentAnswer> {
  const agent = call.caller.agent
  if (agent === null) throw new Refused('by_hand', 'the command line asks the reader nothing')
  const patience = count(call, 'wait_ms', WAIT, MOST_WAIT)

  const id = maybe(call, 'id')
  if (id !== null) {
    if (!asking.knows(agent.id, id))
      throw new Refused('bad_arguments', `there is no question ${id}`)
    return heard(id, patience)
  }

  const kind = need(call, 'kind')
  const message = need(call, 'message')
  if (message.length > MOST_MESSAGE) {
    throw new Refused('bad_arguments', `a message is at most ${MOST_MESSAGE} characters`)
  }

  if (kind === 'notice') {
    show({ title: agent.name, body: message, opened: () => openSession(agent.id) })
    return done({ shown: true })
  }
  if (kind !== 'choice' && kind !== 'text') {
    throw new Refused('bad_arguments', 'kind is notice, choice or text')
  }

  const choices = Array.isArray(call.args.choices)
    ? call.args.choices.map(String).filter((one) => one.trim() !== '')
    : []
  if (kind === 'choice' && (choices.length < 1 || choices.length > MOST_CHOICES)) {
    throw new Refused('bad_arguments', `a choice offers 1 to ${MOST_CHOICES} choices`)
  }

  const question = asking.ask({
    agent: agent.id,
    kind,
    message,
    choices: kind === 'choice' ? choices : [],
    placeholder: maybe(call, 'placeholder'),
  })
  show({
    title: agent.name,
    body: message,
    tag: `ask-${question.id}`,
    opened: () => openSession(agent.id),
    ...(kind === 'text'
      ? {
          reply: {
            placeholder: question.placeholder ?? '',
            send: t('Send'),
            replied: (words: string) => asking.answer(question.id, words),
          },
        }
      : {}),
  })
  return heard(question.id, patience)
}

/** What the reader answered, or the question's id while they have not yet. */
async function heard(id: string, patience: number): Promise<AgentAnswer> {
  const said = await asking.heard(id, patience)
  if (said === null) return done({ id, waiting: true })

  return said.answer === null ? done({ id, dismissed: true }) : done({ id, answer: said.answer })
}

/** The agent's session, shown in the Ask panel: where its question is answered. */
function openSession(agent: string): void {
  agentOpen.id = agent
  revealPanel('ask')
}
