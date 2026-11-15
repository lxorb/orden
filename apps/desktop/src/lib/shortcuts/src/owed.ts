import { account } from '../../accounts/src/api'
import { forget, keep, storedText } from '../../platform/src/api'

const latest = new Map<string, Promise<unknown>>()

export function owedUntilSignOut(key: string): void {
  account.forgetWithSession(() => {
    latest.delete(key)
    forget(key)
  })
}

export function saveOwing(key: string, save: Promise<unknown>): void {
  latest.set(key, save)
  const last = () => latest.get(key) === save
  void save.then(
    () => {
      if (!last()) return
      latest.delete(key)
      forget(key)
    },
    () => {
      if (last()) keep(key, 'yes')
    },
  )
}

export const owes = (key: string): boolean => storedText(key) === 'yes'
