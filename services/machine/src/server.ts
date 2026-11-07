import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { linkFrame, machineFrameOf, SILENT_FOR } from '@orden/online/wire'
import type { Ordend } from './ordend'

const BEHIND = 8 * 1024 * 1024
const CAUGHT_UP = 1024 * 1024

const LINK_PATH = '/link'

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

function allowed(request: IncomingMessage, secret: string): boolean {
  if (!secret) return false
  const given = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1]
  return given !== undefined && timingSafeEqual(digest(given), digest(secret))
}

export interface Options {
  silentFor?: number
}

export function serve(ordend: Ordend, secret: string, options: Options = {}): Server {
  const silentFor = options.silentFor ?? SILENT_FOR
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })
  let current: WebSocket | null = null
  let paused = false
  let heard = 0
  let pinged = false

  const watch = setInterval(() => {
    const behind = current?.bufferedAmount ?? 0
    if (!paused && behind > BEHIND) ordend.pause((paused = true))
    else if (paused && behind < CAUGHT_UP) ordend.pause((paused = false))
    if (current && pinged && Date.now() - heard > silentFor) current.terminate()
  }, 50)
  watch.unref()

  sockets.on('connection', (socket) => {
    current?.close(4000, 'replaced')
    current = socket
    heard = Date.now()
    pinged = false
    ordend.attach((frame) => {
      if (socket.readyState === socket.OPEN) socket.send(linkFrame(frame))
    })
    socket.on('message', (data, binary) => {
      if (current === socket) heard = Date.now()
      if (!binary || !(data instanceof Buffer)) return
      const frame = machineFrameOf(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
      if (frame?.t === 'ping') {
        if (current === socket) pinged = true
        if (socket.readyState === socket.OPEN) socket.send(linkFrame({ t: 'pong' }))
      } else if (frame) void ordend.receive(frame)
    })
    socket.on('close', () => {
      if (current !== socket) return
      current = null
      ordend.attach(null)
      if (paused) ordend.pause((paused = false))
    })
  })

  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
      return
    }
    response.writeHead(404).end()
  })

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (request.url !== LINK_PATH || !allowed(request, secret)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      return
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      sockets.emit('connection', ws, request)
    })
  })

  server.on('close', () => {
    clearInterval(watch)
  })
  return server
}
