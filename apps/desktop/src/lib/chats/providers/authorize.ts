import type { NativeAsk, Posted } from '@orden/chats/provider'
import { invoke, openExternal } from '../../tauri'

interface Opened {
  id: string
  port: number
}

export async function authorize(
  make: (loopback: string) => string,
): Promise<Record<string, string>> {
  const { id, port } = await invoke<Opened>('oauth_loopback_open')
  try {
    await openExternal(make(`http://127.0.0.1:${port}`))
    return await invoke<Record<string, string>>('oauth_loopback_wait', { id })
  } catch (error) {
    await invoke('oauth_loopback_close', { id }).catch(() => undefined)
    throw error
  }
}

export function post(url: string, form: Readonly<Record<string, string>>): Promise<Posted> {
  return invoke<Posted>('oauth_post', { url, form })
}

export async function request(ask: NativeAsk): Promise<Uint8Array> {
  const answer = await invoke<ArrayBuffer>('chat_request', {
    url: ask.url,
    method: ask.method ?? 'GET',
    bearer: ask.bearer ?? null,
    type: ask.type ?? null,
    bytes: ask.body ?? new Uint8Array(0),
  })
  return new Uint8Array(answer)
}

export function builtWith(
  values: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) if (value) out[key] = value
  return out
}
