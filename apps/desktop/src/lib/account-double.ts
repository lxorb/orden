import type { Account, RemoteSpace } from './api'

type Clear = (kept: boolean) => void

export interface AccountDouble {
  token: string | null
  user: Account | null
  guest: null
  spaces: RemoteSpace[]
  readonly accountToken: string | null
  readonly signedIn: boolean
  forgetWithSession(clear: Clear): void
  loadSpaces(): Promise<void>
  signOut(kept?: boolean): void
  signInAs(id: string): void
}

export function userCalled(id: string): Account {
  return { id, email: `${id}@example.com` } as Account
}

export function accountDouble(id: string | null = 'a'): AccountDouble {
  const clears = new Set<Clear>()
  const double: AccountDouble = {
    token: id && `token-${id}`,
    user: id ? userCalled(id) : null,
    guest: null,
    spaces: [],
    get accountToken() {
      return double.user ? double.token : null
    },
    get signedIn() {
      return !!double.token && !!double.user
    },
    forgetWithSession: (clear) => void clears.add(clear),
    loadSpaces: () => Promise.resolve(),
    signOut: (kept = false) => {
      double.token = null
      double.user = null
      double.spaces = []
      for (const clear of clears) clear(kept)
    },
    signInAs: (next) => {
      if (double.token) double.signOut()
      double.token = `token-${next}`
      double.user = userCalled(next)
    },
  }
  return double
}
