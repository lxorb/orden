import { identifier } from '../../../identifier'
import { hostShell, writeSpec } from '../spec'
import { workspace } from '../../../workspace.svelte'
import { type Destination, hostFor } from './hosts'
import { remote } from './hosts.svelte'

const made = new Set<string>()

export function madeNow(key: string): boolean {
  return made.has(key)
}

export function markMade(key: string): void {
  made.add(key)
}

interface Where {
  beside?: string
  behind?: boolean
}

export async function openRemote(id: string, where: Where = {}): Promise<string | null> {
  await remote.ready()
  const host = remote.byId(id)
  if (!host) return null

  const key = identifier()
  made.add(key)
  remote.connected(id)
  const text = writeSpec({ shell: hostShell(id), folder: null, key, name: null })
  return workspace.openUnsaved('terminal', text, host.name, where.beside ?? null, !where.behind).id
}

const ASK_FROM = 10

export async function openAll(ids: readonly string[]): Promise<void> {
  if (ids.length >= ASK_FROM) {
    const { prompt } = await import('../../../ui-kit/src/api')
    const sure = await prompt.confirm({
      title: 'Open all',
      detail: ids.length === 1 ? '1 tab' : `${ids.length} tabs`,
      confirmLabel: 'Open all',
    })
    if (!sure) return
  }

  const [first, ...rest] = ids
  if (first === undefined) return
  const beside = await openRemote(first)
  for (const id of rest) await openRemote(id, { ...(beside ? { beside } : {}), behind: true })
}

export async function connectTo(wanted: Destination): Promise<void> {
  await remote.refresh()
  const host = hostFor(remote.hosts, wanted) ?? (await remote.make(wanted))
  if (host) await openRemote(host.id)
}
