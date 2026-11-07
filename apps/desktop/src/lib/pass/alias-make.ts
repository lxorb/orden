import { blank } from '@orden/pass/envelope'
import type { Alias, Item } from '@orden/pass/types'
import { log } from '../log'
import type { AliasAccount } from './alias-account'
import type { AliasAsk, AliasMade, AliasOptions, AliasService } from './aliases'
import { aliasClient } from './aliases'

export interface AliasKeeper {
  aliasProvider(): Promise<AliasAccount | null>
  update(id: string, content: Alias): Promise<Item>
}

export function aliasContentOf(made: AliasMade, provider: AliasService, title: string): Alias {
  return {
    ...blank('alias'),
    title: title || made.address,
    note: made.note,
    address: made.address,
    provider,
    remoteId: made.remoteId,
    enabled: made.enabled,
    mailboxes: made.mailboxes,
    name: made.name,
  }
}

export function defaultAsk(account: AliasAccount, options: AliasOptions, prefix: string): AliasAsk {
  const usable = options.suffixes.filter((one) => !one.premium)
  const suffix =
    options.suffixes.find((one) => one.value === account.suffix || one.label === account.suffix) ??
    usable[0] ??
    options.suffixes[0]
  const mailbox =
    options.mailboxes.find((one) => one.id === account.mailbox) ??
    options.mailboxes.find((one) => one.isDefault) ??
    options.mailboxes[0]
  return {
    prefix,
    suffix: suffix?.value ?? '',
    mailboxes: mailbox ? [mailbox.id] : [],
    name: '',
    note: '',
  }
}

function stoppable(item: Item): item is Item & { content: Alias } {
  const content = item.content
  return (
    content.kind === 'alias' &&
    content.provider !== 'manual' &&
    content.enabled &&
    content.remoteId !== ''
  )
}

export async function stoppedAliases(keeper: AliasKeeper, items: readonly Item[]): Promise<void> {
  const live = items.filter(stoppable)
  if (!live.length) return
  const account = await keeper.aliasProvider()
  if (!account) return
  const client = aliasClient(account.provider, account.key)
  for (const item of live) {
    if (item.content.provider !== account.provider) continue
    try {
      const enabled = await client.setEnabled(item.content.remoteId, false)
      await keeper.update(item.id, { ...item.content, enabled })
    } catch (error) {
      log(
        'warn',
        `pass: an alias in the trash stayed on: ${error instanceof Error ? error.name : ''}`,
      )
    }
  }
}
