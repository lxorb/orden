import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { Env, Variables } from './types'

const SAID_LIMIT = 300

function withoutAddresses(said: string): string {
  return said.replace(/[^\s@<>,;:"'()[\]]+@[^\s@<>,;:"'()[\]]+/g, '<address>')
}

export function note(at: string, error: unknown, id: string | null): void {
  const named = error instanceof Error ? error : null
  const said = named ? named.message : String(error)

  const coded = (error as { code?: unknown } | null)?.code
  const code = typeof coded === 'string' ? coded : undefined

  console.error(
    JSON.stringify({
      failed: at,
      name: named?.name ?? typeof error,
      code,
      said: withoutAddresses(said).slice(0, SAID_LIMIT),
      id,
    }),
  )
}

export function failed(
  error: Error,
  context: Context<{ Bindings: Env; Variables: Variables }>,
): Response {
  if (error instanceof HTTPException) return error.getResponse()

  const id = context.req.header('cf-ray') ?? null
  note(`${context.req.method} ${new URL(context.req.url).pathname}`, error, id)

  return context.json({ error: 'something went wrong here - try again', id }, 500)
}
