import { slackProvider, type Line, type LineEvents } from '@orden/chats/slack'

function dial(url: string, events: LineEvents): Line {
  const socket = new WebSocket(url)
  socket.onmessage = (event: MessageEvent) => {
    if (typeof event.data === 'string') events.message(event.data)
  }
  socket.onclose = () => events.closed()
  socket.onerror = () => socket.close()
  return { send: (data) => socket.send(data), close: () => socket.close() }
}

export const slack = slackProvider({ dial })
