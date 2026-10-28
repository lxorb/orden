/** Whether an account is kept on a model nobody can talk to (#325): babbage-002, which
 *  Settings once started an OpenAI key on and lists no more. Its own file, so the store
 *  asks it without carrying how the account is moved off it (mend.ts). */

import type { Account } from './accounts'
import { talkable } from './providers'

export function stuck({ kind, model }: Account): boolean {
  return !!model && !talkable(kind, [model]).length
}
