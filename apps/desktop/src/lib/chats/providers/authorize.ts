import type { Posted } from '@orden/chats/provider'
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

export function builtWith(
  values: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) if (value) out[key] = value
  return out
}
