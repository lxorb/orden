/** What Orden lends a chat provider (#321): the vault for its secrets, and on the desktop
 *  a mail connection through the crate (src-tauri/src/mail_socket.rs). */

import type { Host, Socket, SocketAsk } from '@orden/chats/provider'
import { forgetKey, readSecret, writeSecret } from '../../ai/keys'
import { toBase64 } from '../../bytes'
import { Channel } from '../../native'
import { isRecord } from '../../stored'
import { invoke, isDesktop } from '../../tauri'

let opened = 0

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
    write: (bytes) => invoke('mail_socket_write', { id, data: toBase64(bytes) }),
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

export const host: Host = {
  secret: (name) => readSecret(name),
  keepSecret: (name, value) => (value === null ? forgetKey(name, true) : writeSecret(name, value)),
  ...(isDesktop ? { socket } : {}),
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
}
