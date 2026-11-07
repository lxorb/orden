import { parseMessage } from '@orden/chats/mime'

interface Asked {
  id: number
  bytes: Uint8Array
}

self.onmessage = (event: MessageEvent<Asked>) => {
  const { id, bytes } = event.data
  try {
    const parsed = parseMessage(bytes)
    const moved = new Set<ArrayBuffer>()
    for (const part of parsed.attachments) {
      if (part.bytes.buffer instanceof ArrayBuffer) moved.add(part.bytes.buffer)
    }
    self.postMessage({ id, parsed }, { transfer: [...moved] })
  } catch (error) {
    self.postMessage({ id, error: String(error) })
  }
}
