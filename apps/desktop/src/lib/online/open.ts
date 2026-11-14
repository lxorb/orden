import { account } from '../accounts/src/api'
import type { OpenHow } from '../new-tab'
import { termText } from '@orden/online/term'
import { nameOf, samePath } from '../platform/src/api'
import type { Tab } from '../workspace/documents.svelte'
import { workspace } from '../workspace.svelte'
import { type Refused, refusedOf, termSession } from './calls'
import { machine } from './machine.svelte'
import { refusalWords } from './words'
import { MADE_NAME, termName } from './path'

export async function openOnline(beside = false): Promise<Tab | null> {
  const made = await madeOnline(beside ? workspace.activeTabId : null)
  if (typeof made !== 'string') return made
  await refused(made)
  return null
}

export async function madeOnline(
  beside: string | null,
  activate = true,
): Promise<Tab | Refused | null> {
  if (!account.accountToken) return 'signed-out'
  const asking = machine.refresh()
  if (machine.known?.allowed !== true || machine.refused !== null) await asking
  const why = machine.known?.allowed === false ? 'list' : machine.refused
  if (why) return why

  let words: string
  try {
    words = termText(await termSession(null))
  } catch (error) {
    return refusedOf(error)
  }
  if (__EVEN_PLUGIN__) return null
  const tab = workspace.openUnsaved('terminal', words, MADE_NAME, beside, activate)
  workspace.persist()
  return tab
}

export function openTerm(path: string, how: OpenHow = {}, text = ''): Tab | null {
  if (__EVEN_PLUGIN__) return null
  const open = workspace.tabs.find((one) => one.kind === 'terminal' && samePath(one.path, path))
  if (open) {
    if (how.activate !== false) workspace.activeTabId = open.id
    return open
  }

  const beside = how.beside ? workspace.activeTabId : null
  const name = termName(nameOf(path))
  const tab = workspace.openUnsaved('terminal', text, name, beside, how.activate ?? true)
  tab.path = path
  workspace.persist()
  return tab
}

async function refused(why: Refused): Promise<void> {
  if (why === 'signed-out') {
    account.ask()
    return
  }
  const title = refusalWords(why)
  if (title === null) return
  const { prompt } = await import('../prompt.svelte')
  await prompt.choose({ title, options: [{ id: 'ok', label: 'OK', primary: true }] })
}
