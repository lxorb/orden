import { forget, keep, storedText } from './stored'

const OWNER = 'orden:session-owner'

export interface Signed {
  readonly token: string | null
  readonly user: { readonly id: string } | null
  readonly guest: unknown
}

export function sessionOwner(signed: Signed): string | null {
  const user = signed.user?.id ?? null
  if (user !== null) {
    if (storedText(OWNER) !== user) keep(OWNER, user)
    return user
  }
  return signed.token !== null && !signed.guest ? storedText(OWNER) : null
}

export function forgetSessionOwner(): void {
  forget(OWNER)
}
