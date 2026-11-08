import type { Member, Who } from '@orden/chats'
import type { Face } from '../../people/face'
import { people } from '../../people/people.svelte'

export function accountOf(who: Who): string | null {
  return who.startsWith('user:') ? who.slice(5) : null
}

export function nameOf(who: Who, members: readonly Member[], space: string | null): string {
  const id = accountOf(who)
  const listed = members.find((one) => one.who === who)
  const called = id === null ? undefined : people.called(id, space)
  return called ?? listed?.nick ?? listed?.name ?? '?'
}

export function faceOf(who: Who, members: readonly Member[], space: string | null): Face {
  const id = accountOf(who)
  const person = id === null ? undefined : people.of(id)
  return {
    name: nameOf(who, members, space),
    avatar: person?.avatar ?? null,
    key: id ?? who,
  }
}
