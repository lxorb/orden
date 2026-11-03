/** What switching a chat to another model costs, before the reader is asked whether to
 *  (#1089).
 *
 *  A provider keeps what it has read of a conversation for the model that read it: the
 *  prompt cache is per model, and another provider has never seen any of it. So the
 *  first message after a switch sends the whole conversation again at the full price,
 *  which on a long chat is most of a window. That is the cost asked about - the context
 *  as the last request filled it - and nothing is asked below a few thousand tokens,
 *  where it is not worth a question. Where the conversation is past the point the new
 *  model compacts at, it does not fit, and the switch compacts it first with the model
 *  that has it, which the question says. */

import type { AutoCompact, Usage } from './chat/types'
import { compactsAt, filled } from './chat/usage'

/** Below this much context a switch is not asked about. */
export const ASK_FROM = 4_000

export interface SwitchCost {
  /** About how many tokens the next message sends again. */
  tokens: number
  /** Whether the conversation is compacted before the switch. */
  compacts: boolean
}

export function switchCost(
  usage: Usage,
  from: { provider: string; model: string },
  to: { provider: string; model: string; window: number | null },
  auto: AutoCompact = 'auto',
): SwitchCost | null {
  if (from.provider === to.provider && from.model === to.model) return null
  const context = filled(usage)
  if (context < ASK_FROM) return null
  const at = compactsAt(to.window, auto)
  return { tokens: context, compacts: at !== null && context >= at }
}
