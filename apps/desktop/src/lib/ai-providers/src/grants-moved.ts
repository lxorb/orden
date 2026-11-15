import { invoke, isRecord } from '../../platform/src/api'
import { READER_TABS } from './chat/choices'
import type { Account } from './accounts'

type Kept = Record<string, unknown>

const OWN = ['orden-', 'nib-']

const CARRIED = [
  'scopes',
  'spaces',
  'sites',
  'scripts',
  'mode',
  'asks',
  'always',
  'programs',
  'limits',
] as const

async function grants(): Promise<Kept[]> {
  const read = await invoke<unknown>('agents_read')
  return Array.isArray(read) ? read.filter(isRecord) : []
}

function ownOf(all: readonly Kept[], id: string): Kept[] {
  return all.filter((one) => one.built_in === true && OWN.some((at) => one.id === `${at}${id}`))
}

export async function carryGrants(
  moved: Record<string, string>,
  accounts: readonly Account[],
): Promise<void> {
  for (const [from, to] of Object.entries(moved)) {
    const account = accounts.find((one) => one.id === to)
    const before = ownOf(await grants(), from)
    const source = before[0]
    if (!account || !source) continue

    await invoke('ai_agent_tools', {
      agent: { id: to, name: account.name, readerTabs: READER_TABS },
      mode: 'plan',
    })

    const target = `${OWN[0]}${to}`
    const carried = Object.fromEntries(CARRIED.map((key) => [key, source[key]]))
    const after = (await grants())
      .filter((one) => !before.some((old) => old.id === one.id))
      .map((one) => (one.id === target ? { ...one, ...carried } : one))
    await invoke('agents_write', { grants: after })
  }
}
