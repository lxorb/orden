import Bot from 'lucide/dist/esm/icons/bot.mjs'
import Hammer from 'lucide/dist/esm/icons/hammer.mjs'
import Hand from 'lucide/dist/esm/icons/hand.mjs'
import List from 'lucide/dist/esm/icons/list.mjs'
import ListChecks from 'lucide/dist/esm/icons/list-checks.mjs'
import LockOpen from 'lucide/dist/esm/icons/lock-open.mjs'
import Sparkles from 'lucide/dist/esm/icons/sparkles.mjs'
import type { Mode } from '../../ai-providers/src/api'
import type { IconNode } from '../../ui-kit/src/api'

export const MODE_ICONS: Record<Mode, IconNode> = { approve: Hand, auto: Bot, full: LockOpen, plan: List }
export function agentIcon(name: string): IconNode {
  if (name === 'build') return Hammer
  if (name === 'plan') return ListChecks
  return Sparkles
}
