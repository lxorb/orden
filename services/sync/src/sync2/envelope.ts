import { frame, type Framed, unframe } from '@orden/sync-core'
import type { Context } from 'hono'
import { MOST_BODY_BYTES } from '../body'

const OCTETS = 'application/octet-stream'

export async function requestBody(context: Context): Promise<unknown> {
  const said = Number(context.req.header('content-length') ?? '')
  if (Number.isFinite(said) && said > MOST_BODY_BYTES) return undefined

  const type = context.req.header('content-type') ?? ''
  if (type.startsWith(OCTETS)) {
    const bytes = new Uint8Array(await context.req.arrayBuffer())
    if (bytes.length > MOST_BODY_BYTES) return undefined
    return unframe(bytes) ?? undefined
  }

  try {
    return await context.req.json()
  } catch {
    return undefined
  }
}

function framed(context: Context): boolean {
  const type = context.req.header('content-type') ?? ''
  const accept = context.req.header('accept') ?? ''
  return type.startsWith(OCTETS) || accept.includes(OCTETS)
}

export function answer(context: Context, value: Framed, status: 200 | 201 = 200): Response {
  if (framed(context)) {
    return new Response(frame(value), { status, headers: { 'content-type': OCTETS } })
  }
  return context.json(JSON.parse(JSON.stringify(value, bytesAsNumbers)) as object, status)
}

function bytesAsNumbers(_key: string, value: unknown): unknown {
  return value instanceof Uint8Array ? [...value] : value
}
