import { type AgentAnswer, refusal } from '../../automation/caller'
import { DocError } from '../docs/problem'
import type { Code as CrateCode } from '../verbs'

export type Code =
  | CrateCode
  | 'bad_arguments'
  | 'not_granted'
  | 'no_such_space'
  | 'no_such_file'
  | 'exists'
  | 'archived'
  | 'read_only'
  | 'no_such_tab'
  | 'by_hand'
  | 'other_space'
  | 'rev_changed'
  | 'no_such_command'
  | 'no_such_setting'
  | 'no_such_version'
  | 'not_found'
  | 'ambiguous'
  | 'unsupported_on_this_engine'
  | 'timeout'
  | 'failed'

export class Refused extends Error {
  constructor(
    readonly code: Code,
    message: string,
  ) {
    super(message)
    this.name = 'Refused'
  }
}

export function answerOf(error: unknown): AgentAnswer {
  if (error instanceof Refused || error instanceof DocError) {
    return refusal(error.code, error.message)
  }

  return refusal('failed', error instanceof Error ? error.message : String(error))
}
