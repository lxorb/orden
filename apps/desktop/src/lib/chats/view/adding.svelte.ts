import { key, t } from '../../i18n.svelte'
import { workspace } from '../../workspace.svelte'
import { chatsAreOn } from './open'

interface Again {
  provider: string
  account: string
}

class Adding {
  again = $state.raw<Again | null>(null)
  asked = $state(0)
  entered = $state(false)
  busy = $state(false)
}

export const adding = new Adding()

export function addChat(again: Again | null = null): void {
  if (!chatsAreOn()) return
  adding.again = again
  adding.asked += 1
  workspace.openConnect()
}

export function closeAdding(): void {
  adding.entered = false
  workspace.closeConnect()
}

export async function mayLeave(): Promise<boolean> {
  if (!adding.entered && !adding.busy) return true
  const { prompt } = await import('../../prompt.svelte')
  const sure = await prompt.confirm({
    title: t('Stop adding this account?'),
    detail: t('What you entered is not kept.'),
    confirmLabel: key('Discard'),
    danger: true,
  })
  if (sure) adding.entered = false
  return sure
}
