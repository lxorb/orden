import * as node from 'node:crypto'
import { deflateSync } from 'node:zlib'
import type { WireSocket } from '@orden/chats/provider'
import { describe, expect, test, vi } from 'vitest'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
} from './crypto'
import { pipeline } from './stream-promises'
import { Readable } from './stream'
import { promisify } from './util'
import WebSocket, { useWire } from './ws'
import { createInflate, inflate } from './zlib'

const key = node.randomBytes(32)
const iv = node.randomBytes(16)
const data = node.randomBytes(1000)

describe('crypto as Node has it', () => {
  test('hashes and HMACs match', () => {
    for (const name of ['sha256', 'sha512', 'sha1', 'md5'])
      expect(
        createHash(name).update(data.subarray(0, 300)).update(data.subarray(300)).digest('hex'),
      ).toBe(node.createHash(name).update(data).digest('hex'))
    for (const name of ['sha256', 'sha512'])
      expect(createHmac(name, key).update(data).digest()).toEqual(
        node.createHmac(name, key).update(data).digest(),
      )
  })

  test('AES-CBC, CTR and GCM read what Node wrote and Node reads what they wrote', () => {
    for (const name of ['aes-256-cbc', 'aes-256-ctr']) {
      const ours = createCipheriv(name, key, iv)
      const sealed = Buffer.concat([
        ours.update(data.subarray(0, 77)),
        ours.update(data.subarray(77)),
        ours.final(),
      ])
      const theirs = node.createCipheriv(name, key, iv)
      expect(sealed).toEqual(Buffer.concat([theirs.update(data), theirs.final()]))
      const back = createDecipheriv(name, key, iv)
      expect(Buffer.concat([back.update(sealed), back.final()])).toEqual(data)
    }
    const unpadded = createDecipheriv('aes-256-cbc', key, iv).setAutoPadding(false)
    const nodeSealed = node.createCipheriv('aes-256-cbc', key, iv)
    const padded = Buffer.concat([nodeSealed.update(data), nodeSealed.final()])
    expect(
      Buffer.concat([unpadded.update(padded), unpadded.final()]).subarray(0, data.length),
    ).toEqual(data)
    const nonce = node.randomBytes(12)
    const aad = Buffer.from('extra')
    const ours = createCipheriv('aes-256-gcm', key, nonce).setAAD(aad)
    const sealed = Buffer.concat([ours.update(data), ours.final()])
    const tag = ours.getAuthTag()
    const theirs = node.createDecipheriv('aes-256-gcm', key, nonce)
    theirs.setAAD(aad)
    theirs.setAuthTag(tag)
    expect(Buffer.concat([theirs.update(sealed), theirs.final()])).toEqual(data)
    const nodeGcm = node.createCipheriv('aes-256-gcm', key, nonce)
    nodeGcm.setAAD(aad)
    const nodeSealedGcm = Buffer.concat([nodeGcm.update(data), nodeGcm.final()])
    const open = createDecipheriv('aes-256-gcm', key, nonce)
      .setAAD(aad)
      .setAuthTag(nodeGcm.getAuthTag())
    open.update(nodeSealedGcm)
    expect(open.final()).toEqual(data)
    const wrong = createDecipheriv('aes-256-gcm', key, nonce)
      .setAAD(Buffer.from('other'))
      .setAuthTag(tag)
    wrong.update(sealed)
    expect(() => wrong.final()).toThrow()
  })

  test('random bytes and numbers', () => {
    expect(randomBytes(70_000)).toHaveLength(70_000)
    const int = randomInt(2147483647)
    expect(int).toBeGreaterThanOrEqual(0)
    expect(int).toBeLessThan(2147483647)
  })
})

describe('zlib and streams as Node has them', () => {
  test('inflate takes what Node deflated, with a callback and as a stream', async () => {
    const packed = deflateSync(data)
    expect(await promisify(inflate as (...args: unknown[]) => unknown)(packed)).toEqual(data)
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(packed.subarray(0, 100))
        controller.enqueue(packed.subarray(100))
        controller.close()
      },
    })
    const chunks: Buffer[] = []
    const inflater = createInflate()
    inflater.on('data', (chunk: Buffer) => chunks.push(chunk))
    await pipeline(Readable.fromWeb(body), inflater)
    expect(Buffer.concat(chunks)).toEqual(data)
  })
})

describe('the WebSocket over the wire', () => {
  test('asks for the origin, hands bytes both ways and closes once', async () => {
    const asked: unknown[] = []
    const sent: (Uint8Array | string)[] = []
    const wired: {
      hear?: (data: Uint8Array | string) => void
      end?: (reason?: string) => void
    } = {}
    const socket: WireSocket = {
      send: (bytes) => {
        sent.push(bytes)
        return Promise.resolve()
      },
      read(listener, finished) {
        wired.hear = listener
        wired.end = finished
        return () => undefined
      },
      close: () => {
        wired.end?.('closed')
        return Promise.resolve()
      },
    }
    useWire((ask) => {
      asked.push(ask)
      return Promise.resolve(socket)
    })
    const ws = new WebSocket(new URL('wss://web.whatsapp.com/ws/chat'), {
      origin: 'https://web.whatsapp.com',
    })
    await new Promise((resolve) => ws.once('open', resolve))
    expect(asked).toEqual([
      { url: 'wss://web.whatsapp.com/ws/chat', headers: { Origin: 'https://web.whatsapp.com' } },
    ])
    expect(ws.readyState).toBe(WebSocket.OPEN)
    const got: unknown[] = []
    ws.on('message', (message) => got.push(message))
    wired.hear?.(new Uint8Array([1, 2]))
    expect(Buffer.isBuffer(got[0])).toBe(true)
    await promisify(ws.send.bind(ws) as (...args: unknown[]) => unknown)(new Uint8Array([3]))
    expect(sent).toEqual([new Uint8Array([3])])
    const closes: unknown[] = []
    ws.on('close', (code) => closes.push(code))
    ws.close()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(closes).toEqual([1000])
    expect(ws.readyState).toBe(WebSocket.CLOSED)
  })

  test('without a way out it still tells its listeners that it failed and closed', async () => {
    vi.resetModules()
    const { default: Unwired } = await import('./ws')
    const ws = new Unwired('wss://web.whatsapp.com/ws/chat')
    const heard: unknown[] = []
    ws.on('error', (error: Error) => heard.push(error.message))
    ws.on('close', (code: number) => heard.push(code))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(heard).toEqual(['no connection to the outside here', 1006])
    expect(ws.readyState).toBe(Unwired.CLOSED)
  })
})
