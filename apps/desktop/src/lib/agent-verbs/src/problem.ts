import { type AgentAnswer, agentRefusal as refusal } from '@orden/contracts'
import { DocError } from '../../agent-docs/src/api'
import { Refused } from '../../reader-verbs/src/api'

export function answerOf(error: unknown): AgentAnswer {
  if (error instanceof Refused || error instanceof DocError) {
    return refusal(error.code, error.message)
  }
  return refusal('failed', error instanceof Error ? error.message : String(error))
}
export { Refused } from '../../reader-verbs/src/api'
