import { padTradeOf, padWire } from '@orden/sync-core/pad'
import { ApiError, request } from '../api'
import type { PadServer } from './sync'

const missing = (error: unknown): boolean =>
  error instanceof ApiError && (error.status === 404 || error.status === 405)

export function accountPad(token: string): PadServer {
  return {
    trade: async (trade) => {
      try {
        const said = await request<unknown>('/v2/pad', {
          method: 'POST',
          token,
          device: true,
          body: padWire(trade),
        })
        return padTradeOf(said)
      } catch (error) {
        if (missing(error)) return null
        throw error
      }
    },
  }
}
