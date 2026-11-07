import type { Conversation, Member } from '@orden/chats/provider'
import { plural, t } from '../../i18n.svelte'
import { DIVIDER, type MenuEntry } from '../../menu.svelte'
import { prompt } from '../../prompt.svelte'
import { MUTE_HOURS, mutedUntil } from '../bell'
import type { Remote } from '../remote.svelte'

function length(hours: number): string {
  return hours < 24
    ? t('{count} h', { count: hours })
    : plural(hours / 24, { one: '{count} day', other: '{count} days' })
}

function quietly(work: Promise<unknown> | undefined): void {
  void work?.catch(() => undefined)
}

export function conversationMenu(remote: Remote, conversation: Conversation): MenuEntry[] {
  const connection = remote.connection
  if (!connection) return []
  const id = conversation.id
  const now = Date.now()
  const muted = conversation.mutedUntil != null && conversation.mutedUntil > now
  const ruling = conversation.role === 'admin' || conversation.role === 'owner'
  const group = conversation.kind !== 'direct'
  const entries: MenuEntry[] = []
  if (connection.pinConversation)
    entries.push({
      label: conversation.pinned ? t('Unpin') : t('Pin'),
      run: () => quietly(connection.pinConversation?.(id, !conversation.pinned)),
    })
  if (connection.mute)
    entries.push(
      muted
        ? { label: t('Unmute'), run: () => quietly(connection.mute?.(id, null)) }
        : {
            label: t('Mute'),
            run: () => quietly(connection.mute?.(id, mutedUntil(null, Date.now()))),
            more: () =>
              Promise.resolve(
                MUTE_HOURS.map((hours) => ({
                  label: length(hours),
                  run: () => quietly(connection.mute?.(id, mutedUntil(hours, Date.now()))),
                })),
              ),
          },
    )
  if (connection.archive)
    entries.push({
      label: conversation.archived ? t('Unarchive') : t('Archive'),
      run: () => quietly(connection.archive?.(id, !conversation.archived)),
    })
  if (connection.markUnread && conversation.unread === 0)
    entries.push({ label: t('Mark unread'), run: () => quietly(connection.markUnread?.(id)) })
  const managing: MenuEntry[] = []
  if (connection.rename && group && ruling)
    managing.push({ label: t('Rename'), run: () => void rename(remote, conversation) })
  if (connection.invite && connection.people && group && ruling)
    managing.push({ label: t('Add people'), run: () => void invite(remote, conversation) })
  if (connection.leave && group)
    managing.push({ label: t('Leave'), danger: true, run: () => void leave(remote, conversation) })
  return managing.length ? [...entries, DIVIDER, ...managing] : entries
}

async function rename(remote: Remote, conversation: Conversation): Promise<void> {
  const title = await prompt.ask({ title: t('Rename'), value: conversation.title ?? '' })
  if (title?.trim()) quietly(remote.connection?.rename?.(conversation.id, title.trim()))
}

export async function choosePeople(remote: Remote, title: string): Promise<string[]> {
  const connection = remote.connection
  if (!connection?.people) return []
  const query = await prompt.ask({ title, placeholder: t('Name') })
  if (query === null) return []
  const found = await connection.people(query.trim()).catch(() => [])
  if (!found.length) return []
  const chosen = await prompt.find({
    title,
    options: found.map((one) => ({
      id: one.id,
      label: one.handle ? `${one.name} (${one.handle})` : one.name,
    })),
  })
  return chosen ? [chosen] : []
}

async function invite(remote: Remote, conversation: Conversation): Promise<void> {
  const people = await choosePeople(remote, t('Add people'))
  if (people.length) quietly(remote.connection?.invite?.(conversation.id, people))
}

async function leave(remote: Remote, conversation: Conversation): Promise<void> {
  const sure = await prompt.confirm({
    title: t('Leave {chat}?', { chat: conversation.title ?? '' }),
    confirmLabel: t('Leave'),
    danger: true,
  })
  if (sure) quietly(remote.connection?.leave?.(conversation.id))
}

export function memberMenu(
  remote: Remote,
  conversation: Conversation,
  member: Member,
): MenuEntry[] {
  const connection = remote.connection
  const ruling = conversation.role === 'admin' || conversation.role === 'owner'
  if (!connection || !ruling || member.id === remote.source()?.account.self?.id) return []
  if (member.role === 'owner') return []
  const entries: MenuEntry[] = []
  if (connection.promote)
    entries.push(
      member.role === 'admin'
        ? {
            label: t('Remove as admin'),
            run: () => quietly(connection.promote?.(conversation.id, member.id, 'member')),
          }
        : {
            label: t('Make admin'),
            run: () => quietly(connection.promote?.(conversation.id, member.id, 'admin')),
          },
    )
  if (connection.kick)
    entries.push({
      label: t('Remove from chat'),
      danger: true,
      run: () => quietly(connection.kick?.(conversation.id, member.id)),
    })
  return entries
}
