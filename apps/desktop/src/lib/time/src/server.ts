import { timePageOf } from '@orden/sync-core'
import { ApiError, request } from '../../accounts/src/api'
import { isRecord } from '../../platform/src/api'
import type { TimeServer } from './exchange'

const missing = (error: unknown): boolean =>
  error instanceof ApiError && (error.status === 404 || error.status === 405)

export function accountServer(token: string): TimeServer {
  return {
    pull: async (since) => {
      try {
        return timePageOf(await request<unknown>(`/v2/time?since=${since}`, { token }))
      } catch (error) {
        if (missing(error)) return null
        throw error
      }
    },
    push: async (changes) => {
      try {
        const said = await request<unknown>('/v2/time', {
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
