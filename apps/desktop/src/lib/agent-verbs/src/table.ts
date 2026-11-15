import type { AgentAnswer, AgentVerb, AgentVerbs } from '@orden/contracts'
import type { Call } from './call'
import { answerOf, Refused } from './problem'

export type Verb = (call: Call) => AgentAnswer | Promise<AgentAnswer>

function ran(verb: Verb): AgentVerb {
  return async (name, args, caller) => {
    try {
      return await verb({ verb: name, args, caller })
    } catch (error) {
      return answerOf(error)
    }
  }
}

export function verbsOf(table: Readonly<Record<string, Verb>>): AgentVerbs {
  return Object.fromEntries(Object.entries(table).map(([name, verb]) => [name, ran(verb)]))
}

export function gatedBy(on: () => boolean, what: string, verb: Verb): Verb {
  return (call) => {
    if (!on())
      throw new Refused(
        'not_granted',
        `${what} turned off; the reader turns it on in Settings, Experimental`,
      )
    return verb(call)
  }
}
