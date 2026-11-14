import type { Context } from 'hono'
import { tokenIn } from '../said'
import { sha256 } from '../crypto'
import { deviceOfSession } from '../hub/devices'
import type { Env, Variables, Whoever } from '../types'

export async function deviceOf(
  context: Context<{ Bindings: Env; Variables: Variables }>,
): Promise<string> {
  const who = context.get('who')
  if (who.kind === 'guest') return `guest:${who.guest.id}`
  const header = context.req.header('authorization')
  if (who.program) return await programDevice(tokenIn(header) ?? '')

  const device = await deviceOfSession(context.env, who.user.id, header)
  if (device) return device

  return `session:${(await sha256(tokenIn(header) ?? '')).slice(0, 16)}`
}

export async function programDevice(token: string): Promise<string> {
  return `program:${(await sha256(token)).slice(0, 16)}`
}

export function whoseId(who: Whoever): string {
  return who.kind === 'user' ? who.user.id : who.guest.id
}
