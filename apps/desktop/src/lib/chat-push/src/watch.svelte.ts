import { account, request } from '../../accounts/src/api'
import { answer, frameWord, isRecord, keepJson, method, stored } from '../../platform/src/api'
import { type Kept, registrar } from './registrar'

const KEPT = 'orden:chat-push'
function keptHere(): Kept | null {
  const held = stored(KEPT)
  if (!isRecord(held)) return null
  const { token, id, user } = held
  return typeof token === 'string' && typeof id === 'string' && typeof user === 'string' ? { token, id, user } : null
}
export function watchPush(app: string): () => void {
  const read = method('pushToken')
  if (!read) return () => undefined
  let session: string | null = null
  const { settle } = registrar({
    app,
    token: async () => {
      const said = await frameWord()
      try {
        return said ? read(said) : ''
      } catch {
        return ''
      }
    },
    me: () => (account.user && session ? { user: account.user.id, session } : null),
    kept: keptHere,
    keep: (kept) => keepJson(KEPT, kept),
    register: async (session, body) => {
      const said = await request<{ id?: unknown }>('/v2/push/targets', { token: session, body })
      return typeof said.id === 'string' ? said.id : null
    },
    remove: async (session, id) => {
      await request(`/v2/push/targets/${encodeURIComponent(id)}`, { method: 'DELETE', token: session })
    },
    zone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
  answer('__ordenPushToken', () => void settle())
  const online = () => void settle()
  window.addEventListener('online', online)
  const stop = $effect.root(() => {
    $effect(() => {
      session = account.accountToken
      void settle()
    })
  })
  return () => {
    stop()
    window.removeEventListener('online', online)
    answer('__ordenPushToken', undefined)
  }
}
