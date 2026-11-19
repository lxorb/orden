import { samePath } from '../../../platform/src/api'
import type { ChatEntry } from '../shapes'

export interface SpaceChats {
  key: string
  name: string
  chats: ChatEntry[]
}

export function bySpace(chats: readonly ChatEntry[], spaces: readonly { root: string; name: string }[]): SpaceChats[] {
  const groups = spaces
    .map((space) => ({
      key: space.root,
      name: space.name,
      chats: chats.filter((one) => samePath(one.root, space.root)),
    }))
    .filter((group) => group.chats.length)
  const elsewhere = chats.filter((one) => !groups.some((group) => samePath(group.key, one.root)))
  return elsewhere.length ? [...groups, { key: '', name: 'Other spaces', chats: elsewhere }] : groups
}
