import { inboxPageOf } from '@orden/sync-core'
import { ApiError, request } from '../api'
import { isRecord } from '../stored'
import type { InboxServer } from './store'

const missing = (error: unknown): boolean =>
  error instanceof ApiError && (error.status === 404 || error.status === 405)

export function inboxServer(token: string): InboxServer {
  return {
    pull: async (since) => {
      try {
        return inboxPageOf(await request<unknown>(`/v2/inbox?since=${since}`, { token }))
      } catch (error) {
        if (missing(error)) return null
        throw error
      }
    },
    push: async (changes) => {
      try {
        const said = await request<unknown>('/v2/inbox', {
          method: 'POST',
          token,
          body: { changes },
        })
        return isRecord(said) && typeof said.cursor === 'number'
      } catch (error) {
        if (missing(error)) return false
        throw error
      }
    },
  }
}
