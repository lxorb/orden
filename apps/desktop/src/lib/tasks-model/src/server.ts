import { portOf, type SyncApiPort } from '@orden/contracts'
import { inboxPageOf } from '@orden/sync-core'
import type { TodoServer } from './records'

const ROUTE = '/v2/inbox'

const MISSING = new Set([404, 405])

async function answered(
  api: SyncApiPort,
  token: string,
  path: string,
  init: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const response = await api.fetchInTime(`${api.base}${path}`, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${token}`,
    },
  })
  const body: unknown = await response.json().catch(() => null)
  return { status: response.status, body }
}

export function todoServer(token: string): TodoServer | null {
  const port = portOf('sync.api')
  if (!port.ok) return null
  const api = port.value
  return {
    pull: async (since) => {
      const { status, body } = await answered(api, token, `${ROUTE}?since=${since}`, {})
      if (MISSING.has(status)) return null
      if (status >= 400) throw new Error(`the todos could not be read (${status})`)
      return inboxPageOf(body)
    },
    push: async (changes) => {
      const { status, body } = await answered(api, token, ROUTE, {
        method: 'POST',
        body: JSON.stringify({ changes }),
      })
      if (MISSING.has(status)) return false
      if (status >= 400) throw new Error(`the todos could not be sent (${status})`)
      return (
        typeof body === 'object' &&
        body !== null &&
        typeof (body as Record<string, unknown>).cursor === 'number'
      )
    },
  }
}
