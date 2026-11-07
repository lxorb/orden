import type { Alias } from '@orden/pass/types'
import type { AliasStats } from './aliases'
import { aliasClient } from './aliases'
import { pass } from './store.svelte'

async function clientFor(content: Alias) {
  if (content.provider === 'manual' || content.remoteId === '') return null
  const account = await pass.aliasProvider()
  if (account?.provider !== content.provider) return null
  return aliasClient(account.provider, account.key)
}

export async function aliasStats(content: Alias): Promise<AliasStats | null> {
  const client = await clientFor(content)
  return client ? await client.stats(content.remoteId) : null
}

export async function switchedAlias(id: string, content: Alias, on: boolean): Promise<void> {
  const client = await clientFor(content)
  const enabled = client ? await client.setEnabled(content.remoteId, on) : on
  await pass.update(id, { ...content, enabled })
}
