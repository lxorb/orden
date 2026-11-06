import { frame, type Framed, unframe } from '@orden/sync-core'
import app from '../src/index'
import { call, mail, signIn, type TestEnv } from './harness'
import { running } from './room'

export async function invited(
  env: TestEnv,
  owner: string,
  space: string,
  email: string,
  role: 'write' | 'read',
  item?: string,
): Promise<string> {
  const sent = await mail(() =>
    call(env, `/v1/spaces/${space}/share/invite${item ? `?item=${item}` : ''}`, {
      token: owner,
      body: { email, role },
    }),
  )
  const found = /\/join\/([a-f0-9]+)/.exec(sent)
  if (!found?.[1]) throw new Error(`no invitation was sent:\n${sent}`)

  const token = await signIn(env, email)
  await call(env, `/v1/join/${found[1]}`, { method: 'POST', token })
  return token
}

export type Live = ReturnType<typeof running> & {
  settle(): Promise<void>
}

export function live(env: TestEnv): Live {
  const rooms = running(env)
  env.ROOMS = rooms.ROOMS

  const settle = async () => {
    for (let round = 0; round < 20; round++) {
      let fired = false
      for (const { room, state } of rooms.all().values()) {
        await state.idle()
        if (state.takeAlarm() === null) continue
        fired = true
        await room.alarm()
        await state.idle()
      }
      if (!fired) return
    }
    throw new Error('the rooms never stopped settling')
  }

  return { ...rooms, settle }
}

export interface FramedAnswer<T> {
  status: number
  value: T
}

export async function framed<T = Record<string, unknown>>(
  env: TestEnv,
  path: string,
  token: string,
  body?: Framed,
  method = body === undefined ? 'GET' : 'POST',
): Promise<FramedAnswer<T>> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: 'application/octet-stream',
  }
  if (body !== undefined) headers['content-type'] = 'application/octet-stream'

  const response = await app.fetch(
    new Request(`https://nibeditor.com${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: frame(body) }),
    }),
    env,
  )

  const bytes = new Uint8Array(await response.arrayBuffer())
  const type = response.headers.get('content-type') ?? ''
  const value: unknown = type.startsWith('application/octet-stream')
    ? unframe(bytes)
    : JSON.parse(new TextDecoder().decode(bytes))
  return { status: response.status, value: value as T }
}
