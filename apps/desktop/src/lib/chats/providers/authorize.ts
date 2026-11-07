import type { NativeAsk, Posted } from '@orden/chats/provider'
import { invoke, openExternal } from '../../tauri'
import { screens, type Screens } from './screens.svelte'

const FINISH = 'Finish signing in in your browser'

interface Opened {
  id: string
  port: number
}

export async function authorize(
  make: (loopback: string) => string,
  shown: Pick<Screens, 'show' | 'whileWaiting'> = screens,
): Promise<Record<string, string>> {
  const { id, port } = await invoke<Opened>('oauth_loopback_open')
  const close = () => invoke('oauth_loopback_close', { id }).catch(() => undefined)
  const done = shown.whileWaiting(() => void close())
  try {
    const url = make(`http://127.0.0.1:${port}`)
    shown.show({ kind: 'link', url, label: FINISH })
    await openExternal(url)
    return await invoke<Record<string, string>>('oauth_loopback_wait', { id })
  } catch (error) {
    await close()
    throw error
  } finally {
    done()
    shown.show(null)
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
