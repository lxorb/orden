import { hasModifiers, type Member } from '@orden/chats'
import { t } from '../../i18n.svelte'
import type { Row } from '../../palette/rows'
import { firstLine } from './body'
import { nameOf } from './people'
import { store } from './source.svelte'

const UNDER_NOTES = 6
const ALONE = 50

const LINE = 140

export async function messageHits(words: string): Promise<{ rows: Row[]; only: boolean }> {
  const chats = store()
  if (!chats.ready || !chats.me) return { rows: [], only: false }
  const only = hasModifiers(chats.parse(words))
  const hits = (await chats.search(words)).slice(0, only ? ALONE : UNDER_NOTES)

  const members = new Map<string, Member[]>()
  for (const chat of new Set(hits.map((one) => one.chat))) {
    const listed = await chats.members(chat).catch(() => [])
    members.set(
      chat,
      listed.map((one) => ({ who: one.who, name: one.name ?? t('Deleted account') })),
    )
  }

  const rows = hits.flatMap(({ chat, message }): Row[] => {
    const entry = chats.entry(chat)
    if (!entry?.path || message.deleted) return []
    const who = nameOf(message.author, members.get(chat) ?? [], entry.space)
    const line = firstLine(message.body).trim() || (message.files[0]?.name ?? '')
    return [
      {
        kind: 'message',
        chat,
        id: message.id,
        path: entry.path,
        line: line.length > LINE ? `${line.slice(0, LINE)}…` : line,
        where: [`#${entry.name ?? ''}`, who],
      },
    ]
  })
  return { rows, only }
}
