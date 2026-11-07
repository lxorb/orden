import { siteOf } from '@orden/pass/urls'
import type {
  AliasAsk,
  AliasClient,
  AliasFetcher,
  AliasMade,
  AliasMailbox,
  AliasOptions,
  AliasStats,
  Fields,
} from './alias-http'
import { answerOf, countOf, fieldsOf, idOf, listOf, textOf, unreadable } from './alias-http'

const BASE = 'https://app.addy.io/api/v1'

function madeOf(value: unknown): AliasMade {
  const alias = fieldsOf(fieldsOf(value).data)
  if (typeof alias.email !== 'string' || typeof alias.active !== 'boolean') throw unreadable()
  const mailboxes = Array.isArray(alias.recipients)
    ? alias.recipients.map((one) => textOf(fieldsOf(one).email))
    : []
  return {
    remoteId: idOf(alias.id),
    address: alias.email,
    enabled: alias.active,
    mailboxes,
    name: textOf(alias.from_name),
    note: textOf(alias.description),
  }
}

function prefixFor(hostname: string | undefined): string {
  if (!hostname) return ''
  const site = siteOf(`https://${hostname}`) ?? hostname
  return (site.split('.')[0] ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function addy(key: string, fetcher: AliasFetcher): AliasClient {
  const asked = (path: string, method = 'GET', body?: unknown) =>
    answerOf(fetcher, `${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  const mailboxes = async (): Promise<AliasMailbox[]> => {
    const [recipients, account] = await Promise.all([
      asked('/recipients?filter%5Bverified%5D=true'),
      asked('/account-details'),
    ])
    const fallback = textOf(fieldsOf(fieldsOf(account).data).default_recipient_id)
    return listOf(fieldsOf(recipients).data).map((value) => {
      const one = fieldsOf(value)
      const id = idOf(one.id)
      return { id, email: textOf(one.email), isDefault: id === fallback }
    })
  }

  const domains = async (): Promise<{ all: string[]; fallback: string }> => {
    const answer = fieldsOf(await asked('/domain-options'))
    const all = listOf(answer.data)
      .map(textOf)
      .filter((one) => one !== '')
    return { all, fallback: textOf(answer.defaultAliasDomain) || (all[0] ?? '') }
  }

  const made = async (body: Fields): Promise<AliasMade> =>
    madeOf(await asked('/aliases', 'POST', body))

  return {
    mailboxes,

    async options(hostname?: string): Promise<AliasOptions> {
      const [found, boxes] = await Promise.all([domains(), mailboxes()])
      const ordered = [found.fallback, ...found.all.filter((one) => one !== found.fallback)]
      return {
        prefix: prefixFor(hostname),
        suffixes: ordered
          .filter((one) => one !== '')
          .map((domain) => ({ value: domain, label: `@${domain}`, premium: false })),
        mailboxes: boxes,
        canCreate: ordered.some((one) => one !== ''),
      }
    },

    async create(ask: AliasAsk): Promise<AliasMade> {
      const body: Fields = { domain: ask.suffix, description: ask.note }
      if (ask.prefix !== '') {
        body.format = 'custom'
        body.local_part = ask.prefix
      }
      if (ask.mailboxes.length) body.recipient_ids = ask.mailboxes
      const alias = await made(body)
      if (ask.name === '') return alias
      await asked(`/aliases/${encodeURIComponent(alias.remoteId)}`, 'PATCH', {
        from_name: ask.name,
      })
      return { ...alias, name: ask.name }
    },

    async random(note: string): Promise<AliasMade> {
      const { fallback } = await domains()
      if (fallback === '') throw unreadable()
      return await made({ domain: fallback, description: note })
    },

    async setEnabled(remoteId: string, on: boolean): Promise<boolean> {
      if (on) {
        return madeOf(await asked('/active-aliases', 'POST', { id: remoteId })).enabled
      }
      await asked(`/active-aliases/${encodeURIComponent(remoteId)}`, 'DELETE')
      return false
    },

    async remove(remoteId: string): Promise<void> {
      await asked(`/aliases/${encodeURIComponent(remoteId)}`, 'DELETE')
    },

    async stats(remoteId: string): Promise<AliasStats> {
      const alias = fieldsOf(fieldsOf(await asked(`/aliases/${encodeURIComponent(remoteId)}`)).data)
      return {
        forwarded: countOf(alias.emails_forwarded),
        replied: countOf(alias.emails_replied),
        blocked: countOf(alias.emails_blocked),
        days: null,
      }
    },
  }
}
