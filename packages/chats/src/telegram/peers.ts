import type { tl } from '@mtcute/core'
import type { ConversationRole, Person } from '../provider'
import { UNKNOWN } from '../provider'
import type { Found } from './client'

export interface Where {
  kind: 'u' | 'c' | 's'
  id: number
  topic?: number
}

export type Group = tl.RawChat | tl.RawChannel

const ID = /^([ucs])(\d+)(?:t(\d+))?$/

export function whereOf(conversation: string): Where {
  const match = ID.exec(conversation)
  if (!match) throw new Error('not a Telegram conversation')
  const kind = match[1] as Where['kind']
  const where: Where = { kind, id: Number(match[2]) }
  if (match[3] !== undefined) where.topic = Number(match[3])
  return where
}

export function idOf(where: Where): string {
  return `${where.kind}${where.id}${where.topic === undefined ? '' : `t${where.topic}`}`
}

export function peerId(peer: tl.TypePeer): string {
  switch (peer._) {
    case 'peerUser':
      return `u${peer.userId}`
    case 'peerChat':
      return `c${peer.chatId}`
    case 'peerChannel':
      return `s${peer.channelId}`
  }
}

export function fullName(user: tl.RawUser): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
  if (name) return name
  if (user.username) return `@${user.username}`
  if (user.phone) return `+${user.phone}`
  return UNKNOWN
}

function usernameOf(user: tl.RawUser | tl.RawChannel): string | undefined {
  return user.username ?? user.usernames?.find((one) => one.active)?.username
}

export class Peers {
  readonly users = new Map<number, tl.RawUser>()
  readonly chats = new Map<number, tl.RawChat>()
  readonly channels = new Map<number, tl.RawChannel>()
  self = 0

  add(found: Found): void {
    for (const user of found.users) {
      if (user._ !== 'user') continue
      const known = this.users.get(user.id)
      if (user.min && known && !known.min) {
        this.users.set(user.id, { ...known, ...pick(user) })
      } else this.users.set(user.id, user)
    }
    for (const chat of found.chats) {
      if (chat._ === 'chat') this.chats.set(chat.id, chat)
      else if (chat._ === 'channel') {
        const known = this.channels.get(chat.id)
        if (chat.min && known && !known.min)
          this.channels.set(chat.id, {
            ...chat,
            min: false,
            ...(known.accessHash ? { accessHash: known.accessHash } : {}),
          })
        else this.channels.set(chat.id, chat)
      } else if (chat._ === 'chatForbidden') this.chats.delete(chat.id)
      else if (chat._ === 'channelForbidden') this.channels.delete(chat.id)
    }
  }

  input(where: Where): tl.TypeInputPeer {
    if (where.kind === 'c') return { _: 'inputPeerChat', chatId: where.id }
    if (where.kind === 'u') {
      if (where.id === this.self) return { _: 'inputPeerSelf' }
      const user = this.users.get(where.id)
      if (!user?.accessHash) throw new Error('Telegram does not know this person yet')
      return { _: 'inputPeerUser', userId: where.id, accessHash: user.accessHash }
    }
    const channel = this.channels.get(where.id)
    if (!channel?.accessHash) throw new Error('Telegram does not know this group yet')
    return { _: 'inputPeerChannel', channelId: where.id, accessHash: channel.accessHash }
  }

  inputUser(person: string): tl.TypeInputUser {
    const where = whereOf(person)
    if (where.kind !== 'u') throw new Error('not a Telegram person')
    if (where.id === this.self) return { _: 'inputUserSelf' }
    const user = this.users.get(where.id)
    if (!user?.accessHash) throw new Error('Telegram does not know this person yet')
    return { _: 'inputUser', userId: where.id, accessHash: user.accessHash }
  }

  inputChannel(where: Where): tl.TypeInputChannel {
    const peer = this.input({ kind: 's', id: where.id })
    if (peer._ !== 'inputPeerChannel') throw new Error('not a Telegram group')
    return { _: 'inputChannel', channelId: peer.channelId, accessHash: peer.accessHash }
  }

  group(where: Where): Group | undefined {
    return where.kind === 'c'
      ? this.chats.get(where.id)
      : where.kind === 's'
        ? this.channels.get(where.id)
        : undefined
  }

  forum(id: number): boolean {
    return !!this.channels.get(id)?.forum
  }

  person(peer: tl.TypePeer | undefined): Person {
    if (!peer) return { id: 'u0', name: '' }
    const id = peerId(peer)
    if (peer._ === 'peerUser') {
      const user = this.users.get(peer.userId)
      if (!user) return { id, name: UNKNOWN }
      return personOf(user)
    }
    const group =
      peer._ === 'peerChat' ? this.chats.get(peer.chatId) : this.channels.get(peer.channelId)
    const person: Person = { id, name: group?.title ?? UNKNOWN }
    const handle = group?._ === 'channel' ? usernameOf(group) : undefined
    if (handle) person.handle = handle
    if (group?.photo._ === 'chatPhoto') person.picture = id
    return person
  }

  byHandle(handle: string): tl.RawUser | undefined {
    const wanted = handle.toLowerCase()
    for (const user of this.users.values())
      if (usernameOf(user)?.toLowerCase() === wanted) return user
    return undefined
  }

  role(where: Where): ConversationRole {
    const group = this.group(where)
    if (!group) return 'member'
    if (group.creator) return 'owner'
    return group.adminRights ? 'admin' : 'member'
  }
}

function pick(user: tl.RawUser): Partial<tl.RawUser> {
  const out: Partial<tl.RawUser> = {}
  if (user.firstName !== undefined) out.firstName = user.firstName
  if (user.lastName !== undefined) out.lastName = user.lastName
  if (user.username !== undefined) out.username = user.username
  if (user.photo !== undefined) out.photo = user.photo
  if (user.status !== undefined) out.status = user.status
  return out
}

export function personOf(user: tl.RawUser): Person {
  const person: Person = { id: `u${user.id}`, name: fullName(user) }
  const handle = usernameOf(user)
  if (handle) person.handle = handle
  if (user.phone) person.phone = `+${user.phone}`
  if (user.photo?._ === 'userProfilePhoto') person.picture = `u${user.id}`
  return person
}
