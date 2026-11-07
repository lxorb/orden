import type { Host, Socket, SocketAsk, WireAsk, WireSocket } from '@orden/chats/provider'
import { forgetKey, readSecret, writeSecret } from '../../ai/keys'
import { Channel } from '../../native'
import { isRecord } from '../../stored'
import { invoke, isDesktop } from '../../tauri'
import { BASE } from '../../api'
import { authorize, builtWith, post, request } from './authorize'
import { parsedOffThread } from './mail-parse'
import { screens } from './screens.svelte'
import { sealedStore } from './sealed'

let opened = 0

export const PIECE = 256 * 1024

export async function writtenInPieces(
  bytes: Uint8Array,
  write: (piece: Uint8Array) => Promise<unknown>,
): Promise<void> {
  for (let at = 0; at === 0 || at < bytes.length; at += PIECE)
    await write(bytes.subarray(at, at + PIECE))
}

async function socket(ask: SocketAsk): Promise<Socket> {
  const id = `m${Date.now().toString(36)}-${++opened}`
  const output = new Channel<unknown>()
  const early: Uint8Array[] = []
  let ended: { reason: string } | null = null
  let hear: ((bytes: Uint8Array) => void) | null = null
  let end: ((reason?: string) => void) | null = null
  output.onmessage = (message) => {
    if (message instanceof ArrayBuffer) {
      const bytes = new Uint8Array(message)
      if (hear) hear(bytes)
      else early.push(bytes)
    } else if (isRecord(message) && typeof message.end === 'string') {
      ended = { reason: message.end }
      end?.(message.end)
    }
  }
  await invoke('mail_socket_open', { id, host: ask.host, port: ask.port, tls: ask.tls, output })
  return {
    write: (bytes) =>
      writtenInPieces(bytes, (piece) => invoke('mail_socket_write', { id, bytes: piece })),
    read(listener, finished) {
      hear = listener
      end = finished
      for (const bytes of early.splice(0)) listener(bytes)
      if (ended) finished(ended.reason)
      return () => {
        hear = null
        end = null
      }
    },
    startTls: () => invoke('mail_socket_tls', { id }),
    close: () => invoke('mail_socket_close', { id }),
  }
}

async function wire(ask: WireAsk): Promise<WireSocket> {
  const id = `w${Date.now().toString(36)}-${++opened}`
  const output = new Channel<unknown>()
  const early: (Uint8Array | string)[] = []
  let ended: { reason: string } | null = null
  let hear: ((data: Uint8Array | string) => void) | null = null
  let end: ((reason?: string) => void) | null = null
  const heard = (data: Uint8Array | string) => {
    if (hear) hear(data)
    else early.push(data)
  }
  output.onmessage = (message) => {
    if (message instanceof ArrayBuffer) heard(new Uint8Array(message))
    else if (isRecord(message) && typeof message.text === 'string') heard(message.text)
    else if (isRecord(message) && typeof message.end === 'string') {
      ended = { reason: message.end }
      end?.(message.end)
    }
  }
  await invoke('wire_socket_open', {
    id,
    url: ask.url,
    headers: ask.headers ?? {},
    protocols: ask.protocols ?? [],
    output,
  })
  return {
    send: (data) =>
      typeof data === 'string'
        ? invoke('wire_socket_send_text', { id, text: data })
        : invoke('wire_socket_send', { id, bytes: data }),
    read(listener, finished) {
      hear = listener
      end = finished
      for (const data of early.splice(0)) listener(data)
      if (ended) finished(ended.reason)
      return () => {
        hear = null
        end = null
      }
    },
    close: () => invoke('wire_socket_close', { id }),
  }
}

export const host: Host = {
  secret: (name) => readSecret(name),
  keepSecret: (name, value) => (value === null ? forgetKey(name, true) : writeSecret(name, value)),
  ...(isDesktop ? { socket, authorize, post, request, wire } : {}),
  parseMessage: parsedOffThread,
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
  build: builtWith({
    googleClientId: import.meta.env.VITE_ORDEN_GOOGLE_CLIENT_ID,
    googleClientSecret: import.meta.env.VITE_ORDEN_GOOGLE_CLIENT_SECRET,
    microsoftClientId: import.meta.env.VITE_ORDEN_MICROSOFT_CLIENT_ID,
    telegramApiId: import.meta.env.VITE_ORDEN_TELEGRAM_API_ID,
    telegramApiHash: import.meta.env.VITE_ORDEN_TELEGRAM_API_HASH,
    slackClientId: import.meta.env.VITE_ORDEN_SLACK_CLIENT_ID,
    ordenServer: BASE,
  }),
  ask: screens.ask,
  show: screens.show,
  sealed: sealedStore({ read: readSecret, write: (name, value) => host.keepSecret(name, value) }),
}
