import type { tl } from '@mtcute/core'
import Long from 'long'
import { describe, expect, test } from 'vitest'
import { entitiesOf, markdownOf, withMentions } from './entities'
import { channel, user } from './fake'
import { attachmentsOf, messageOf, pollOf, reactionsOf, type Context } from './messages'
import { idOf, Peers, whereOf } from './peers'
import { MOST_TEXT, piecesOf } from './pieces'
import { oggCrc, oggOf, packedOf, samplesOf, waveOf } from './voice'

function peers(): Peers {
  const found = new Peers()
  found.self = 1
  found.add({
    users: [
      user(1, 'Emil', { self: true }),
      user(2, 'Mia', { username: 'mia_k' }),
      user(3, 'Noah'),
    ],
    chats: [
      channel(50, 'Forum', { forum: true }),
      channel(60, 'News', { megagroup: false, broadcast: true }),
    ],
  })
  return found
}

function context(extra: Partial<Context> = {}): Context {
  return { peers: peers(), self: 'u1', readOut: () => 10, ...extra }
}

describe('conversation ids', () => {
  test('name a person, a group, a channel and a forum topic and read back', () => {
    for (const id of ['u2', 'c40', 's50', 's50t7']) expect(idOf(whereOf(id))).toBe(id)
    expect(() => whereOf('x1')).toThrow()
  })
})

describe('formatting', () => {
  test('entities become markdown, with the plain text escaped', () => {
    const entities: tl.TypeMessageEntity[] = [
      { _: 'messageEntityBold', offset: 0, length: 4 },
      { _: 'messageEntityItalic', offset: 5, length: 3 },
      { _: 'messageEntityCode', offset: 9, length: 3 },
      { _: 'messageEntityTextUrl', offset: 13, length: 4, url: 'https://orden.so' },
    ]
    expect(markdownOf('bold ita a*b link 2*3', entities)).toBe(
      '**bold** _ita_ `a*b` [link](https://orden.so) 2\\*3',
    )
  })

  test('a pre block keeps its language and a quote its lines', () => {
    expect(
      markdownOf('let x', [{ _: 'messageEntityPre', offset: 0, length: 5, language: 'ts' }]),
    ).toBe('```ts\nlet x\n```')
    expect(
      markdownOf('one\ntwo\nthree', [{ _: 'messageEntityBlockquote', offset: 0, length: 7 }]),
    ).toBe('> one\n> two\nthree')
  })

  test('markdown becomes entities with UTF-16 offsets', () => {
    const parsed = entitiesOf('😀 **bold** and _it_ ~~gone~~ ||secret|| `x` [here](https://a.b)')
    expect(parsed.text).toBe('😀 bold and it gone secret x here')
    expect(parsed.entities).toEqual([
      { _: 'messageEntityBold', offset: 3, length: 4 },
      { _: 'messageEntityItalic', offset: 12, length: 2 },
      { _: 'messageEntityStrike', offset: 15, length: 4 },
      { _: 'messageEntitySpoiler', offset: 20, length: 6 },
      { _: 'messageEntityCode', offset: 27, length: 1 },
      { _: 'messageEntityTextUrl', offset: 29, length: 4, url: 'https://a.b' },
    ])
  })

  test('snake_case and a lone star stay words', () => {
    expect(entitiesOf('snake_case_name and 2 * 3').entities).toEqual([])
    expect(entitiesOf('snake_case_name and 2 * 3').text).toBe('snake_case_name and 2 * 3')
  })

  test('code fences and quotes go out as pre and blockquote', () => {
    const parsed = entitiesOf('> said\n> twice\n```py\nprint(1)\n```')
    expect(parsed.text).toBe('said\ntwice\nprint(1)')
    expect(parsed.entities).toEqual([
      { _: 'messageEntityBlockquote', offset: 0, length: 10 },
      { _: 'messageEntityPre', offset: 11, length: 8, language: 'py' },
    ])
  })

  test('markdown survives the trip out and back', () => {
    for (const written of [
      '**a** _b_ ~~c~~ `d`',
      '[x](https://y.z) and \\*not\\*',
      'plain words',
    ]) {
      const parsed = entitiesOf(written)
      expect(markdownOf(parsed.text, parsed.entities)).toBe(written)
    }
  })

  test('a mention of someone without a username names them by id', () => {
    const input: tl.TypeInputUser = { _: 'inputUser', userId: 3, accessHash: Long.fromNumber(21) }
    const done = withMentions(entitiesOf('hi @Noah and **you**'), [
      { name: 'Noah', user: input },
      { name: 'Mia', handle: 'mia_k', user: input },
    ])
    expect(done.text).toBe('hi Noah and you')
    expect(done.entities).toEqual([
      { _: 'inputMessageEntityMentionName', offset: 3, length: 4, userId: input },
      { _: 'messageEntityBold', offset: 12, length: 3 },
    ])
  })
})

describe('voice', () => {
  test('a waveform packs into five bits and back', () => {
    const wave = Array.from({ length: 100 }, (_, at) => Math.round((at % 32) * (255 / 31)))
    const packed = packedOf(wave)
    expect(packed?.length).toBe(63)
    expect(waveOf(packed)?.slice(0, 100)).toEqual(wave)
  })

  test('an opus packet says how long it is', () => {
    expect(samplesOf(new Uint8Array([0xfc]))).toBe(960)
    expect(samplesOf(new Uint8Array([(16 << 3) | 0]))).toBe(120)
    expect(samplesOf(new Uint8Array([(0 << 3) | 3, 3]))).toBe(1440)
  })

  test('the Ogg checksum is CRC-32 with no reflection, no start value and no final xor', () => {
    expect(oggCrc(new TextEncoder().encode('123456789'))).toBe(0x89a1897f)
  })

  test('webm from the recorder becomes Ogg Opus', () => {
    const element = (id: number[], body: number[]) => [...id, 0x80 | body.length, ...body]
    const unknown = (id: number[], body: number[]) => [
      ...id,
      0x01,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      ...body,
    ]
    const codec = element([0x86], [...new TextEncoder().encode('A_OPUS')])
    const head = element(
      [0x63, 0xa2],
      [...new TextEncoder().encode('OpusHead'), 1, 1, 0x38, 1, 0x80, 0xbb, 0, 0, 0, 0, 0],
    )
    const track = element([0xae], [...codec, ...head])
    const tracks = element([0x16, 0x54, 0xae, 0x6b], track)
    const block = (frame: number[]) => element([0xa3], [0x81, 0, 0, 0x80, ...frame])
    const cluster = unknown(
      [0x1f, 0x43, 0xb6, 0x75],
      [...element([0xe7], [0]), ...block([0xfc, 1, 2]), ...block([0xfc, 3])],
    )
    const webm = new Uint8Array(unknown([0x18, 0x53, 0x80, 0x67], [...tracks, ...cluster]))
    const ogg = oggOf(webm, 'audio/webm;codecs=opus')
    expect(ogg).not.toBeNull()
    const bytes = ogg ?? new Uint8Array()
    const pages: { kind: number; granule: number; body: Uint8Array }[] = []
    for (let at = 0; at < bytes.length;) {
      expect(new TextDecoder().decode(bytes.subarray(at, at + 4))).toBe('OggS')
      const view = new DataView(bytes.buffer, bytes.byteOffset + at)
      const count = bytes[at + 26] ?? 0
      const length = [...bytes.subarray(at + 27, at + 27 + count)].reduce(
        (sum, one) => sum + one,
        0,
      )
      const page = bytes.slice(at, at + 27 + count + length)
      const crc = view.getUint32(22, true)
      page.set([0, 0, 0, 0], 22)
      expect(oggCrc(page)).toBe(crc)
      pages.push({
        kind: bytes[at + 5] ?? 0,
        granule: view.getUint32(6, true),
        body: page.subarray(27 + count),
      })
      at += 27 + count + length
    }
    expect(pages.map((one) => one.kind)).toEqual([2, 0, 0, 4])
    expect(new TextDecoder().decode(pages[0]?.body.subarray(0, 8))).toBe('OpusHead')
    expect(new TextDecoder().decode(pages[1]?.body.subarray(0, 8))).toBe('OpusTags')
    expect(pages.map((one) => one.granule)).toEqual([0, 0, 960, 1920])
    expect([...(pages[2]?.body ?? [])]).toEqual([0xfc, 1, 2])
  })

  test('ogg passes through and what cannot be remuxed says so', () => {
    const ogg = new Uint8Array([1, 2])
    expect(oggOf(ogg, 'audio/ogg')).toBe(ogg)
    expect(oggOf(new Uint8Array([1]), 'audio/mp4')).toBeNull()
  })
})

describe('messages', () => {
  const photo: tl.RawPhoto = {
    _: 'photo',
    id: Long.fromNumber(9),
    accessHash: Long.fromNumber(1),
    fileReference: new Uint8Array([1]),
    date: 1,
    dcId: 2,
    sizes: [
      { _: 'photoStrippedSize', type: 'i', bytes: new Uint8Array([1]) },
      { _: 'photoSize', type: 'm', w: 320, h: 240, size: 100 },
      { _: 'photoSizeProgressive', type: 'y', w: 1280, h: 960, sizes: [10, 900] },
    ],
  }

  function document(
    attributes: tl.TypeDocumentAttribute[],
    mimeType: string,
    extra: Partial<tl.RawDocument> = {},
  ): tl.RawDocument {
    return {
      _: 'document',
      id: Long.fromNumber(77),
      accessHash: Long.fromNumber(1),
      fileReference: new Uint8Array([1]),
      date: 1,
      mimeType,
      size: 5000,
      dcId: 4,
      attributes,
      ...extra,
    }
  }

  test('a photo is its largest size', () => {
    expect(attachmentsOf({ _: 'messageMediaPhoto', photo })).toEqual([
      {
        ref: 'm',
        name: 'photo-9.jpg',
        type: 'image/jpeg',
        size: 900,
        kind: 'image',
        width: 1280,
        height: 960,
      },
    ])
  })

  test('a voice note has its seconds and wave, a GIF and a video are told apart', () => {
    const waveform = packedOf([0, 255, 128])
    const voice = attachmentsOf({
      _: 'messageMediaDocument',
      voice: true,
      document: document(
        [
          {
            _: 'documentAttributeAudio',
            voice: true,
            duration: 4,
            ...(waveform ? { waveform } : {}),
          },
        ],
        'audio/ogg',
      ),
    })[0]
    expect(voice).toMatchObject({
      kind: 'voice',
      seconds: 4,
      type: 'audio/ogg',
      name: 'voice-77.ogg',
    })
    expect(voice?.wave?.length).toBe(100)
    const gif = attachmentsOf({
      _: 'messageMediaDocument',
      document: document(
        [
          { _: 'documentAttributeAnimated' },
          { _: 'documentAttributeVideo', duration: 2, w: 200, h: 100 },
        ],
        'video/mp4',
      ),
    })[0]
    expect(gif).toMatchObject({ kind: 'gif', width: 200, height: 100 })
    const video = attachmentsOf({
      _: 'messageMediaDocument',
      document: document(
        [
          { _: 'documentAttributeVideo', duration: 9, w: 1920, h: 1080 },
          { _: 'documentAttributeFilename', fileName: 'trip.mp4' },
        ],
        'video/mp4',
      ),
    })[0]
    expect(video).toMatchObject({ kind: 'video', seconds: 9, name: 'trip.mp4' })
  })

  test('an animated sticker shows its still thumbnail', () => {
    const sticker = attachmentsOf({
      _: 'messageMediaDocument',
      document: document(
        [{ _: 'documentAttributeSticker', alt: '😀', stickerset: { _: 'inputStickerSetEmpty' } }],
        'application/x-tgsticker',
        { thumbs: [{ _: 'photoSize', type: 'm', w: 128, h: 128, size: 300 }] },
      ),
    })[0]
    expect(sticker).toMatchObject({
      kind: 'sticker',
      ref: 'm:m',
      type: 'image/webp',
      size: 300,
      width: 128,
    })
  })

  test('reactions name who is known and count the rest', () => {
    const reactions: tl.TypeMessageReactions = {
      _: 'messageReactions',
      results: [
        {
          _: 'reactionCount',
          reaction: { _: 'reactionEmoji', emoticon: '👍' },
          count: 3,
          chosenOrder: 0,
        },
        {
          _: 'reactionCount',
          reaction: { _: 'reactionCustomEmoji', documentId: Long.ONE },
          count: 1,
        },
      ],
      recentReactions: [
        {
          _: 'messagePeerReaction',
          peerId: { _: 'peerUser', userId: 2 },
          date: 1,
          reaction: { _: 'reactionEmoji', emoticon: '👍' },
        },
      ],
    }
    expect(reactionsOf(reactions, 'u1')).toEqual({ '👍': ['u1', 'u2', 'anon:👍0'] })
  })

  test('an anonymous poll gives counts and what I chose', () => {
    const poll = pollOf({
      _: 'messageMediaPoll',
      poll: {
        _: 'poll',
        id: Long.ONE,
        hash: Long.ZERO,
        multipleChoice: true,
        closeDate: 1_800_000_000,
        question: { _: 'textWithEntities', text: 'Lunch?', entities: [] },
        answers: [
          {
            _: 'pollAnswer',
            text: { _: 'textWithEntities', text: 'Pizza', entities: [] },
            option: new Uint8Array([0]),
          },
          {
            _: 'pollAnswer',
            text: { _: 'textWithEntities', text: 'Ramen', entities: [] },
            option: new Uint8Array([1]),
          },
        ],
      },
      results: {
        _: 'pollResults',
        results: [
          { _: 'pollAnswerVoters', option: new Uint8Array([1]), voters: 4, chosen: true },
          { _: 'pollAnswerVoters', option: new Uint8Array([0]), voters: 2 },
        ],
      },
    })
    expect(poll).toEqual({
      question: 'Lunch?',
      answers: ['Pizza', 'Ramen'],
      several: true,
      counts: [2, 4],
      mine: [1],
      ends: 1_800_000_000_000,
    })
  })

  test('a message carries its reply, mentions, edit, pin and whether it was read', () => {
    const found = messageOf(
      {
        _: 'message',
        id: 9,
        out: true,
        mentioned: true,
        pinned: true,
        editDate: 1_700_000_100,
        peerId: { _: 'peerUser', userId: 2 },
        fromId: { _: 'peerUser', userId: 1 },
        date: 1_700_000_000,
        message: 'hey @mia_k',
        entities: [{ _: 'messageEntityMention', offset: 4, length: 6 }],
        replyTo: { _: 'messageReplyHeader', replyToMsgId: 4 },
      },
      context(),
    )
    expect(found).toMatchObject({
      id: '9',
      conversation: 'u2',
      mine: true,
      replyTo: '4',
      pinned: true,
      editedAt: 1_700_000_100_000,
      mentions: ['u1', 'u2'],
      delivery: 'read',
      text: 'hey @mia_k',
    })
    expect(
      messageOf(
        {
          _: 'message',
          id: 11,
          out: true,
          peerId: { _: 'peerUser', userId: 2 },
          date: 1,
          message: 'x',
        },
        context(),
      )?.delivery,
    ).toBe('sent')
  })

  test('a message in a forum belongs to its topic, and a topic root is no reply', () => {
    const inTopic = messageOf(
      text(30, { _: 'peerChannel', channelId: 50 }, 2, 'hi', {
        replyTo: { _: 'messageReplyHeader', forumTopic: true, replyToMsgId: 7 },
      }),
      context(),
    )
    expect(inTopic).toMatchObject({ conversation: 's50t7' })
    expect(inTopic?.replyTo).toBeUndefined()
    const answer = messageOf(
      text(31, { _: 'peerChannel', channelId: 50 }, 2, 'yes', {
        replyTo: { _: 'messageReplyHeader', forumTopic: true, replyToMsgId: 30, replyToTopId: 7 },
      }),
      context(),
    )
    expect(answer).toMatchObject({ conversation: 's50t7', replyTo: '30' })
    expect(
      messageOf(text(32, { _: 'peerChannel', channelId: 50 }, 2, 'general'), context())
        ?.conversation,
    ).toBe('s50t1')
  })

  test('a channel post counts its comments and a service message reads as words', () => {
    const post = messageOf(
      text(5, { _: 'peerChannel', channelId: 60 }, 0, 'news', {
        fromId: { _: 'peerChannel', channelId: 60 },
        post: true,
        replies: { _: 'messageReplies', comments: true, replies: 12, repliesPts: 1 },
      }),
      context(),
    )
    expect(post).toMatchObject({ replies: 12, author: { id: 's60', name: 'News' } })
    const joined = messageOf(
      {
        _: 'messageService',
        id: 6,
        peerId: { _: 'peerChat', chatId: 40 },
        fromId: { _: 'peerUser', userId: 3 },
        date: 1,
        action: { _: 'messageActionChatAddUser', users: [3] },
      },
      context(),
    )
    expect(joined).toMatchObject({ system: true, text: 'Noah joined', conversation: 'c40' })
  })
})

function text(
  id: number,
  peer: tl.TypePeer,
  from: number,
  words: string,
  extra: Partial<tl.RawMessage> = {},
): tl.RawMessage {
  return {
    _: 'message',
    id,
    peerId: peer,
    fromId: { _: 'peerUser', userId: from },
    date: 1,
    message: words,
    ...extra,
  }
}

describe('long text in pieces', () => {
  test('a text over the limit is cut at a paragraph, and a mark across the cut is in both pieces', () => {
    const one = 'a'.repeat(30)
    const two = 'b'.repeat(30)
    const text = `${one}\n\n${two}`
    const bold: tl.TypeMessageEntity = { _: 'messageEntityBold', offset: 25, length: 12 }
    expect(piecesOf(text, [bold], 40)).toEqual([
      { message: one, entities: [{ ...bold, offset: 25, length: 5 }] },
      { message: two, entities: [{ ...bold, offset: 0, length: 5 }] },
    ])
  })

  test('no piece is longer than the limit, and an emoji is never cut in half', () => {
    const text = `x${'😀'.repeat(3000)}`
    const pieces = piecesOf(text, [], MOST_TEXT)
    expect(pieces.length).toBe(2)
    expect(pieces.map((one) => one.message).join('')).toBe(text)
    for (const piece of pieces) expect(piece.message.length).toBeLessThanOrEqual(MOST_TEXT)
    expect(pieces[1]?.message.codePointAt(0)).toBe(0x1f600)
    expect(piecesOf('short', [])).toEqual([{ message: 'short', entities: [] }])
  })
})
