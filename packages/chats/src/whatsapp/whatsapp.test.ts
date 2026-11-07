import type { WAMessage } from '@whiskeysockets/baileys'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Host } from '../provider'
import { Cache } from './cache'
import { FakeHost, FakeKit, ANNA, GROUP, ME, incoming } from './fake'
import { markdownOf, whatsappOf } from './format'
import { WARNING, whatsappProvider } from './index'
import { messageOf, type Context, WAITING } from './map'
import { openMedia, sealMedia, upload, uploadToken } from './media'
import { authName, packed, Shelf, unpacked } from './shelf'

afterEach(() => {
  vi.useRealTimers()
})

describe('formatting', () => {
  test('WhatsApp marks become markdown and back', () => {
    expect(markdownOf('*bold* _it_ ~gone~ ```*code*``` `*inline*`')).toBe(
      '**bold** _it_ ~~gone~~ ```*code*``` `*inline*`',
    )
    expect(whatsappOf('**bold** *it* _it_ ~~gone~~ `**code**`')).toBe(
      '*bold* _it_ _it_ ~gone~ `**code**`',
    )
    expect(whatsappOf(markdownOf('a *b* c'))).toBe('a *b* c')
  })

  test('stars inside words or with spaces are left alone', () => {
    expect(markdownOf('2*3*4 and * not *')).toBe('2*3*4 and * not *')
    expect(whatsappOf('5 * 6 * 7')).toBe('5 * 6 * 7')
  })
})

describe('media', () => {
  test('sealed media opens again and a changed byte is refused', async () => {
    const plain = new TextEncoder().encode('a picture, honestly')
    const sealed = await sealMedia(plain, 'image')
    expect(sealed.fileLength).toBe(plain.length)
    expect(sealed.body.length % 16).toBe(10)
    expect(await openMedia(sealed.body, sealed.mediaKey, 'image')).toEqual(plain)
    await expect(openMedia(sealed.body, sealed.mediaKey, 'video')).rejects.toThrow()
    const broken = sealed.body.slice()
    broken[0] = (broken[0] ?? 0) ^ 1
    await expect(openMedia(broken, sealed.mediaKey, 'image')).rejects.toThrow('damaged')
  })

  test('the upload goes to the media host with the token and auth', async () => {
    const sealed = await sealMedia(new Uint8Array([1, 2, 3]), 'document')
    const seen: string[] = []
    const fetcher = ((url: string) => {
      seen.push(url)
      return Promise.resolve(
        new Response(JSON.stringify({ url: 'https://mmg/x', direct_path: '/v/x' })),
      )
    }) as unknown as typeof fetch
    const placed = await upload(
      fetcher,
      { hosts: [{ hostname: 'mmg.example' }], auth: 'a+b/c=' },
      sealed,
      'document',
    )
    expect(placed).toEqual({ url: 'https://mmg/x', directPath: '/v/x' })
    const token = uploadToken(sealed.fileEncSha256)
    expect(token).not.toMatch(/[+/=]/)
    expect(seen).toEqual([
      `https://mmg.example/mms/document/${token}?auth=a%2Bb%2Fc%3D&token=${token}`,
    ])
  })
})

describe('the sealed sign-in state', () => {
  test('bytes survive packing and the state is written once after a burst', async () => {
    vi.useFakeTimers()
    const host = new FakeHost()
    const kit = new FakeKit()
    const shelf = new Shelf(host, kit, kit.fresh())
    await shelf.keepAs('41790000001')
    const before = host.writes
    for (let at = 0; at < 20; at++)
      await shelf.keys.set({ session: { [`s${at}`]: new Uint8Array([at, 255]) } })
    shelf.credsChanged({ registered: true })
    expect(host.writes).toBe(before)
    await vi.advanceTimersByTimeAsync(1500)
    expect(host.writes).toBe(before + 1)
    const again = await Shelf.read(host, kit, '41790000001')
    expect(again?.creds.registered).toBe(true)
    expect(await again?.keys.get('session', ['s7', 'missing'])).toEqual({
      s7: new Uint8Array([7, 255]),
    })
    await again?.keys.set({ session: { s7: null } })
    await again?.flush()
    expect(await (await Shelf.read(host, kit, '41790000001'))?.keys.get('session', ['s7'])).toEqual(
      {},
    )
  })

  test('closing writes what is still waiting and forgetting removes it', async () => {
    vi.useFakeTimers()
    const host = new FakeHost()
    const kit = new FakeKit()
    const shelf = new Shelf(host, kit, kit.fresh())
    await shelf.keepAs('1')
    await shelf.keys.set({
      'pre-key': { 1: { public: new Uint8Array([9]), private: new Uint8Array([8]) } },
    })
    await shelf.flush()
    const kept = unpacked(new TextDecoder().decode(host.bigs.get(authName('1'))), (one) => one) as {
      keys: { 'pre-key': Record<string, { public: Uint8Array }> }
    }
    expect(kept.keys['pre-key'][1]?.public).toEqual(new Uint8Array([9]))
    await shelf.forget()
    expect(host.bigs.has(authName('1'))).toBe(false)
  })

  test('nothing is written in the clear and Buffer-like JSON is packed as base64', () => {
    const text = packed({ a: { type: 'Buffer', data: [1, 2] }, b: new Uint8Array([3]) })
    expect(text).toBe('{"a":{"type":"Buffer","data":"AQI="},"b":{"type":"Buffer","data":"Aw=="}}')
  })
})

describe('the device cache', () => {
  test('keeps messages in time order and comes back from the sealed store', async () => {
    const host = new FakeHost()
    const kit = new FakeKit()
    const cache = new Cache(host, kit)
    await cache.keepAs('1')
    cache.put(incoming('M3', ANNA, { conversation: 'three' }))
    cache.put(incoming('M1', ANNA, { conversation: 'one' }))
    cache.put(incoming('M2', ANNA, { conversation: 'two' }))
    cache.chats.set(ANNA, { id: ANNA, unread: 2, lastAt: 5 })
    await cache.flush()
    const back = new Cache(host, kit)
    await back.load('1')
    expect(back.list(ANNA).map((one) => one.key.id)).toEqual(['M1', 'M2', 'M3'])
    expect(back.chats.get(ANNA)?.unread).toBe(2)
  })
})

function context(): Context {
  return {
    self: { id: ME, name: 'Me' },
    person: (jid, pushName) => ({ id: jid, name: pushName ?? jid.split('@')[0] ?? jid }),
    poll: () => undefined,
    reactions: () => undefined,
    pinned: () => false,
  }
}

describe('messages', () => {
  const at = (message: WAMessage) => messageOf(message, context())

  test('an image with a caption, a reply, mentions and a preview', () => {
    const mapped = at(
      incoming(
        'I1',
        GROUP,
        {
          imageMessage: {
            caption: 'look @41790000003 *now*',
            mimetype: 'image/jpeg',
            fileLength: 2048,
            width: 640,
            height: 480,
            jpegThumbnail: new Uint8Array([1, 2]),
            contextInfo: {
              stanzaId: 'Q1',
              mentionedJid: ['41790000003@s.whatsapp.net'],
              isForwarded: true,
              expiration: 86400,
            },
          },
        },
        { key: { participant: ANNA } },
      ),
    )
    expect(mapped).toMatchObject({
      id: 'I1',
      conversation: GROUP,
      author: { id: ANNA, name: 'Anna' },
      text: 'look @41790000003 **now**',
      replyTo: 'Q1',
      mentions: ['41790000003@s.whatsapp.net'],
      forwarded: true,
      expiresAt: (1_800_000_000 + 1) * 1000 + 86_400_000,
      attachments: [
        {
          ref: 'media',
          name: 'photo.jpg',
          type: 'image/jpeg',
          size: 2048,
          kind: 'image',
          width: 640,
          height: 480,
          preview: 'data:image/jpeg;base64,AQI=',
        },
      ],
    })
  })

  test('voice notes, GIFs, stickers, documents and places', () => {
    expect(
      at(
        incoming('V1', ANNA, {
          audioMessage: {
            ptt: true,
            seconds: 3,
            waveform: new Uint8Array([0, 50, 100]),
            mimetype: 'audio/ogg; codecs=opus',
          },
        }),
      )?.attachments[0],
    ).toMatchObject({
      kind: 'voice',
      seconds: 3,
      wave: [0, 0.5, 1],
      type: 'audio/ogg',
      name: 'voice.ogg',
    })
    expect(
      at(incoming('G1', ANNA, { videoMessage: { gifPlayback: true, mimetype: 'video/mp4' } }))
        ?.attachments[0]?.kind,
    ).toBe('gif')
    expect(
      at(incoming('S1', ANNA, { stickerMessage: { mimetype: 'image/webp' } }))?.attachments[0]
        ?.kind,
    ).toBe('sticker')
    expect(
      at(
        incoming('D1', ANNA, {
          documentWithCaptionMessage: {
            message: {
              documentMessage: {
                fileName: 'plan.pdf',
                mimetype: 'application/pdf',
                caption: 'the plan',
              },
            },
          },
        }),
      ),
    ).toMatchObject({
      text: 'the plan',
      attachments: [{ name: 'plan.pdf', kind: 'file' }],
    })
    expect(
      at(
        incoming('L1', ANNA, {
          locationMessage: { degreesLatitude: 47.37, degreesLongitude: 8.54, name: 'ETH' },
        }),
      )?.text,
    ).toBe('📍 ETH https://maps.google.com/?q=47.37,8.54')
  })

  test('deleted, waiting, system and behind-the-scenes messages', () => {
    expect(at(incoming('X1', ANNA, null, { messageStubType: 1 }))?.deleted).toBe(true)
    expect(at(incoming('X2', ANNA, null, { messageStubType: 2 }))).toMatchObject({
      text: WAITING,
      system: true,
    })
    expect(
      at(
        incoming('X3', GROUP, null, {
          messageStubType: 27,
          messageStubParameters: [ANNA],
          key: { participant: ME, fromMe: true },
        }),
      ),
    ).toMatchObject({
      system: true,
      text: 'Me added 41790000002',
    })
    expect(
      at(incoming('X4', ANNA, { reactionMessage: { text: '👍', key: { id: 'X1' } } })),
    ).toBeNull()
    expect(at(incoming('X5', ANNA, { protocolMessage: { type: 0 } }))).toBeNull()
  })

  test('my own messages carry how far they got', () => {
    const mine = (status: number) =>
      at(incoming('O1', ANNA, { conversation: 'hi' }, { key: { fromMe: true }, status }))?.delivery
    expect([0, 1, 2, 3, 4, 5].map(mine)).toEqual([
      'failed',
      'sending',
      'sent',
      'delivered',
      'read',
      'read',
    ])
  })
})

describe('the provider', () => {
  test('warns, and is offered only where a wire, a sealed store and a screen exist', () => {
    const provider = whatsappProvider(() => Promise.resolve(new FakeKit()))
    expect(provider.warning).toBe(WARNING)
    expect(provider.can.reactions).toBe('one')
    expect(provider.can.editFor).toBe(15 * 60 * 1000)
    const host = new FakeHost()
    expect(provider.available(host)).toBe(true)
    const withoutWire: Host = {
      secret: (name) => host.secret(name),
      keepSecret: (name, value) => host.keepSecret(name, value),
      fetch: host.fetch,
      now: () => host.now(),
      sealed: host.sealed,
      show: host.show,
    }
    expect(provider.available(withoutWire)).toBe(false)
  })
})
