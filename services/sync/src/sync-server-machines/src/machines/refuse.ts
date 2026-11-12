import { type Refusal, text } from '@orden/online/wire'

export const REFUSED_CLOSE = 4404

export function refuse(server: WebSocket, error: Refusal): void {
  server.accept()
  server.send(text({ t: 'refused', error }))
  server.close(REFUSED_CLOSE, error)
}

export function refusedSocket(error: Refusal, protocol: string): Response {
  const pair = new WebSocketPair()
  refuse(pair[1], error)
  return new Response(null, {
    status: 101,
    webSocket: pair[0],
    headers: { 'sec-websocket-protocol': protocol },
  })
}
