import type { LoginItem } from '@orden/pass/monitor'
import type { Login } from '@orden/pass/types'

export type Saving = { do: 'none' } | { do: 'save' } | { do: 'update'; id: string }

const NONE: Saving = { do: 'none' }
const SAVE: Saving = { do: 'save' }

function folded(text: string): string {
  return text.trim().toLowerCase()
}

function namedBy(login: Login, username: string): boolean {
  const wanted = folded(username)
  return wanted !== '' && (folded(login.username) === wanted || folded(login.email) === wanted)
}

function updated(one: LoginItem | undefined): Saving {
  return one ? { do: 'update', id: one.id } : SAVE
}

export function savingOf(
  logins: readonly LoginItem[],
  username: string | null,
  password: string,
  old: string | null,
): Saving {
  const held = old === null ? undefined : logins.find((one) => one.content.password === old)
  if (username !== null && username.trim() !== '') {
    const named = logins.filter((one) => namedBy(one.content, username))
    if (named.some((one) => one.content.password === password)) return NONE
    return updated(named[0] ?? held)
  }
  if (logins.some((one) => one.content.password === password)) return NONE
  return updated(held)
}
