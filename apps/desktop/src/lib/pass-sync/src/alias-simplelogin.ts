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
import { answerOf, fieldsOf, idOf, listOf, textOf, unreadable, withQuery } from './alias-http'

const BASE = 'https://app.simplelogin.io'
const DAY = 24 * 60 * 60 * 1000
const MOST_PAGES = 20

function madeOf(value: unknown): AliasMade {
  const alias = fieldsOf(value)
  if (typeof alias.email !== 'string' || typeof alias.enabled !== 'boolean') throw unreadable()
  const mailboxes = Array.isArray(alias.mailboxes)
    ? alias.mailboxes.map((one) => textOf(fieldsOf(one).email))
    : []
  return {
    remoteId: idOf(alias.id),
    address: alias.email,
    enabled: alias.enabled,
    mailboxes,
    name: textOf(alias.name),
    note: textOf(alias.note),
  }
}

function mailboxOf(value: unknown): AliasMailbox {
  const box = fieldsOf(value)
  return { id: idOf(box.id), email: textOf(box.email), isDefault: box.default === true }
}

function suffixOf(value: unknown): { value: string; label: string; premium: boolean } {
  const one = fieldsOf(value)
  const signed = one.signed_suffix ?? one['signed-suffix']
  if (typeof signed !== 'string' || typeof one.suffix !== 'string') throw unreadable()
  return { value: signed, label: one.suffix, premium: one.is_premium === true }
}

export function simpleLogin(key: string, fetcher: AliasFetcher): AliasClient {
  const asked = (path: string, method = 'GET', body?: unknown) =>
    answerOf(fetcher, `${BASE}${path}`, {
      method,
      headers: {
        Authentication: key,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  const mailboxes = async (): Promise<AliasMailbox[]> =>
    listOf(fieldsOf(await asked('/api/v2/mailboxes')).mailboxes).map(mailboxOf)

  const toggled = async (remoteId: string): Promise<boolean> => {
    const answer = fieldsOf(
      await asked(`/api/aliases/${encodeURIComponent(remoteId)}/toggle`, 'POST'),
    )
    if (typeof answer.enabled !== 'boolean') throw unreadable()
    return answer.enabled
  }

  return {
    mailboxes,

    async options(hostname?: string): Promise<AliasOptions> {
      const [answer, boxes] = await Promise.all([
        asked(withQuery('/api/v5/alias/options', { hostname })),
        mailboxes(),
      ])
      const options = fieldsOf(answer)
      return {
        prefix: textOf(options.prefix_suggestion),
        suffixes: listOf(options.suffixes).map(suffixOf),
        mailboxes: boxes,
        canCreate: options.can_create === true,
      }
    },

    async create(ask: AliasAsk, hostname?: string): Promise<AliasMade> {
      const body: Fields = {
        alias_prefix: ask.prefix,
        signed_suffix: ask.suffix,
        mailbox_ids: ask.mailboxes.map(Number),
        note: ask.note,
        name: ask.name,
      }
      return madeOf(await asked(withQuery('/api/v3/alias/custom/new', { hostname }), 'POST', body))
    },

    async random(note: string, hostname?: string): Promise<AliasMade> {
      return madeOf(await asked(withQuery('/api/alias/random/new', { hostname }), 'POST', { note }))
    },

    async setEnabled(remoteId: string, on: boolean): Promise<boolean> {
      const first = await toggled(remoteId)
      return first === on ? first : await toggled(remoteId)
    },

    async remove(remoteId: string): Promise<void> {
      await asked(`/api/aliases/${encodeURIComponent(remoteId)}`, 'DELETE')
    },

    async stats(remoteId: string, now = Date.now(), days = 14): Promise<AliasStats> {
      const since = (now - days * DAY) / 1000
      const stats: AliasStats = { forwarded: 0, replied: 0, blocked: 0, days }
      for (let page = 0; page < MOST_PAGES; page++) {
        const path = `/api/aliases/${encodeURIComponent(remoteId)}/activities?page_id=${String(page)}`
        const activities = listOf(fieldsOf(await asked(path)).activities)
        let older = false
        for (const value of activities) {
          const one = fieldsOf(value)
          if (typeof one.timestamp !== 'number' || one.timestamp < since) {
            older = true
            continue
          }
          if (one.action === 'forward') stats.forwarded++
          else if (one.action === 'reply') stats.replied++
          else if (one.action === 'block') stats.blocked++
        }
        if (older || !activities.length) break
      }
      return stats
    },
  }
}
