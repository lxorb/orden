import { siteOf } from '@orden/pass/urls'
import type { Alias, Item } from '@orden/pass/types'
import type { AliasAccount } from './alias-account'
import { aliasContentOf, defaultAsk } from './alias-make'
import type { AliasAsk, AliasOptions } from './aliases'
import { aliasClient } from './aliases'
import { pass } from './store.svelte'

function titleFor(hostname: string | undefined, address: string): string {
  if (!hostname) return address
  return siteOf(`https://${hostname}`) ?? hostname
}

export async function newAlias(prefix?: string, hostname?: string): Promise<Item | null> {
  if (pass.state !== 'open') return null
  const account = await pass.aliasProvider()
  const chosen = pass.vaults.find((one) => one.id === pass.settings.defaultVault)
  const vault = (chosen ?? pass.vaults[0])?.id
  if (!account || !vault) return null
  const client = aliasClient(account.provider, account.key)
  const options = await client.options(hostname)
  if (!options.canCreate) return null
  const typed = prefix?.trim() ?? ''
  const ask = defaultAsk(account, options, typed === '' ? options.prefix : typed)
  const note = hostname ?? ''
  const made =
    ask.prefix === '' || ask.suffix === ''
      ? await client.random(note, hostname)
      : await client.create({ ...ask, note }, hostname)
  const content = aliasContentOf(made, account.provider, titleFor(hostname, made.address))
  return await pass.create(vault, content)
}

export async function aliasOptions(
  hostname?: string,
): Promise<{ account: AliasAccount; options: AliasOptions } | null> {
  const account = await pass.aliasProvider()
  if (!account) return null
  return { account, options: await aliasClient(account.provider, account.key).options(hostname) }
}

export async function providedAlias(ask: AliasAsk, content: Alias): Promise<Alias> {
  const account = await pass.aliasProvider()
  if (!account) throw new Error('pass: no alias service is connected')
  const client = aliasClient(account.provider, account.key)
  const made = await client.create({ ...ask, name: content.name, note: content.note })
  return { ...aliasContentOf(made, account.provider, content.title), note: content.note }
}
