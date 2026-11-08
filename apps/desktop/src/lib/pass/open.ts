import { t } from '../i18n.svelte'
import type { Tab } from '../workspace/documents.svelte'
import { workspace } from '../workspace.svelte'
import { passOn } from '../settings.svelte'
import { asked, type PassIntent } from './asked.svelte'
import { FIRST_VIEW, writeView } from './view'

function passTab(): Tab | null {
  return workspace.singleHere('pass')
}

export function openPass(intent: PassIntent | null = null): Tab | null {
  if (!passOn()) return null
  if (intent) asked.intent = intent
  const open = passTab()
  if (open) {
    workspace.activate(open.id)
    return open
  }
  return workspace.openUnsaved('pass', writeView(FIRST_VIEW), t('Pass'))
}

export async function lockPass(): Promise<void> {
  const { pass } = await import('./store.svelte')
  pass.lock()
}

export async function quietPass(): Promise<void> {
  const [{ pass }, { autofill }] = await Promise.all([
    import('./store.svelte'),
    import('./autofill'),
  ])
  autofill.quiet()
  pass.lock()
}
