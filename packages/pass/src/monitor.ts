import { strengthOf } from './strength'
import { offersTwoFactor } from './two-factor'
import type { Item, Login } from './types'
import { siteOf } from './urls'

export const FLAGS = ['compromised', 'weak', 'reused', 'inactive2fa', 'excluded'] as const

export type Flag = (typeof FLAGS)[number]

export interface Report {
  weak: string[]
  reused: Map<string, string[]>
  inactive2fa: string[]
  excluded: string[]
  compromised: string[]
}

export type LoginItem = Item & { content: Login }

export function isLoginItem(item: Item): item is LoginItem {
  return item.content.kind === 'login'
}

export function activeLogins(items: readonly Item[]): LoginItem[] {
  return items.filter(isLoginItem).filter((item) => item.trashed === null)
}

export function watchedLogins(items: readonly Item[]): LoginItem[] {
  return activeLogins(items).filter((item) => item.monitored)
}

export function hasTwoFactor(login: Login): boolean {
  return (
    login.totp.trim() !== '' ||
    login.passkeys.length > 0 ||
    login.fields.some((field) => field.kind === 'totp' && field.value.trim() !== '')
  )
}

export function offersTwoFactorFor(login: Login): boolean {
  return login.websites.some((website) => {
    const site = siteOf(website.url)
    return site !== null && offersTwoFactor(site)
  })
}

function reusedOf(logins: readonly LoginItem[]): Map<string, string[]> {
  const byPassword = new Map<string, string[]>()
  for (const item of logins) {
    const password = item.content.password
    if (password === '') continue
    const ids = byPassword.get(password)
    if (ids) ids.push(item.id)
    else byPassword.set(password, [item.id])
  }
  const reused = new Map<string, string[]>()
  for (const ids of byPassword.values()) {
    if (ids.length < 2) continue
    for (const id of ids)
      reused.set(
        id,
        ids.filter((other) => other !== id),
      )
  }
  return reused
}

export function report(
  items: readonly Item[],
  compromised: ReadonlySet<string> = new Set(),
): Report {
  const active = activeLogins(items)
  const watched = active.filter((item) => item.monitored)
  return {
    weak: watched
      .filter((item) => item.content.password !== '')
      .filter((item) => strengthOf(item.content.password).strength !== 'strong')
      .map((item) => item.id),
    reused: reusedOf(watched),
    inactive2fa: watched
      .filter((item) => !hasTwoFactor(item.content) && offersTwoFactorFor(item.content))
      .map((item) => item.id),
    excluded: active.filter((item) => !item.monitored).map((item) => item.id),
    compromised: watched.filter((item) => compromised.has(item.id)).map((item) => item.id),
  }
}

export function flagsOf(item: Item, of: Report): Flag[] {
  const has: Record<Flag, boolean> = {
    compromised: of.compromised.includes(item.id),
    weak: of.weak.includes(item.id),
    reused: of.reused.has(item.id),
    inactive2fa: of.inactive2fa.includes(item.id),
    excluded: of.excluded.includes(item.id),
  }
  return FLAGS.filter((flag) => has[flag])
}
