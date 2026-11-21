import Bot from 'lucide/dist/esm/icons/bot.mjs'
import Hand from 'lucide/dist/esm/icons/hand.mjs'
import List from 'lucide/dist/esm/icons/list.mjs'
import LockOpen from 'lucide/dist/esm/icons/lock-open.mjs'
import type { Mode } from '../../ai-providers/src/api'
import type { IconNode } from '../../ui-kit/src/api'

export const MODE_ICONS: Record<Mode, IconNode> = { approve: Hand, auto: Bot, full: LockOpen, plan: List }
