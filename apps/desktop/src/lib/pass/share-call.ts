import { account } from '../accounts/src/api'
import { BASE, request } from '../accounts/src/api'
import { hub } from '../sync-client/src/api'
import { ShareApi } from './share-api'

export interface Signed {
  api: ShareApi
  email: string
  origin: string
}

export function signedSharing(): Signed {
  const token = account.token
  const user = account.user
  if (!token || !user) throw new Error('pass: sign in to share')
  const api = new ShareApi(
    (path, method, body) =>
      request(path, {
        ...(method ? { method } : {}),
        ...(body === undefined ? {} : { body }),
        token,
      }),
    () => hub.device,
  )
  return { api, email: user.email, origin: BASE === '' ? globalThis.location.origin : BASE }
}
