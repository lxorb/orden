import type { AgentAnswer } from '../automation/caller'
import { show } from '../notify'
import { agentOpen } from '../ai/sidebar/agent-open.svelte'
import { revealPanel } from '../focus'
import { asking } from '../agents/src/api'
import { type Call, count, done, maybe, need } from './call'
import { Refused } from './problem'
import { stopRefused, stopSignal } from './stopping'

const WAIT = 60_000
const MOST_WAIT = 120_000

const MOST_CHOICES = 12
const MOST_MESSAGE = 2000
const LONGEST_CHOICE = 200
const MOST_OPEN = 5

export async function askReader(call: Call): Promise<AgentAnswer> {
  const agent = call.caller.agent
  if (agent === null) throw new Refused('by_hand', 'the command line asks the reader nothing')
  const patience = count(call, 'wait_ms', WAIT, MOST_WAIT)

  const id = maybe(call, 'id')
  if (id !== null) {
    if (!asking.knows(agent.id, id))
      throw new Refused('bad_arguments', `there is no question ${id}`)
    return heard(call, id, patience)
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
  const placeholder = maybe(call, 'placeholder')
  if ([...choices, placeholder ?? ''].some((one) => one.length > LONGEST_CHOICE)) {
    throw new Refused(
      'bad_arguments',
      `a choice or placeholder is at most ${LONGEST_CHOICE} characters`,
    )
  }

  if (asking.of(agent.id).length >= MOST_OPEN) {
    throw new Refused(
      'bad_arguments',
      `the reader has ${MOST_OPEN} of your questions open: ask about one by its id first`,
    )
  }

  const question = asking.ask({
    agent: agent.id,
    kind,
    message,
    choices: kind === 'choice' ? choices : [],
    placeholder,
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
            send: 'Send',
            replied: (words: string) => asking.answer(question.id, words),
          },
        }
      : {}),
  })
  return heard(call, question.id, patience)
}

async function heard(call: Call, id: string, patience: number): Promise<AgentAnswer> {
  const halting = await stopSignal(call)
  const said = await asking.heard(id, patience, halting.signal).finally(halting.end)
  if (halting.signal.aborted && said === null) throw stopRefused(`question ${id} is still open`)
  if (said === null) return done({ id, waiting: true })

  return said.answer === null ? done({ id, dismissed: true }) : done({ id, answer: said.answer })
}

function openSession(agent: string): void {
  agentOpen.id = agent
  revealPanel('ask')
}
