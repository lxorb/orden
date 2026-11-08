import { Buffer } from 'buffer'
import Long from 'long'
import protobuf from 'protobufjs/minimal.js'
import type { WireAsk, WireSocket } from '@orden/chats/provider'
import type { Kit, Link } from '@orden/chats/whatsapp'
import { quiet } from './whatsapp-log'
import { useWire } from './node/ws'

function buffered(data: Uint8Array): Buffer {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength)
}

export async function kit(wire: (ask: WireAsk) => Promise<WireSocket>): Promise<Kit> {
  protobuf.util.Buffer = Buffer
  protobuf.util.Long = Long
  protobuf.configure()
  useWire(wire)
  const baileys = await import('@whiskeysockets/baileys')
  const { proto } = baileys
  return {
    dial(setup): Link {
      const sock = baileys.makeWASocket({
        auth: { creds: setup.creds, keys: setup.keys },
        logger: quiet,
        browser: baileys.Browsers.macOS('Desktop'),
        markOnlineOnConnect: false,
        getMessage: (key) => setup.message(key),
      })
      return {
        on: (event, hear) => {
          sock.ev.on(event, hear)
        },
        pairingCode: (phone) => sock.requestPairingCode(phone),
        send: (jid, content, options) => sock.sendMessage(jid, content, options),
        async relay(jid, message) {
          const made = baileys.generateWAMessageFromContent(jid, message, {
            userJid: sock.user?.id ?? setup.creds.me?.id ?? '',
          })
          if (made.message && made.key.id)
            await sock.relayMessage(jid, made.message, { messageId: made.key.id })
          return made
        },
        async mediaConn() {
          const found = await sock.refreshMediaConn(false)
          return { hosts: found.hosts, auth: found.auth }
        },
        reupload: (message) => sock.updateMediaMessage(message),
        modify: (change, jid) => sock.chatModify(change, jid),
        read: (keys) => sock.readMessages(keys),
        presence: (kind, jid) => sock.sendPresenceUpdate(kind, jid),
        subscribe: (jid) => sock.presenceSubscribe(jid),
        group: (jid) => sock.groupMetadata(jid),
        groups: () => sock.groupFetchAllParticipating(),
        async participants(jid, people, action) {
          await sock.groupParticipantsUpdate(jid, people, action)
        },
        subject: (jid, text) => sock.groupUpdateSubject(jid, text),
        description: (jid, text) => sock.groupUpdateDescription(jid, text),
        leave: (jid) => sock.groupLeave(jid),
        picture: (jid) => sock.profilePictureUrl(jid, 'image'),
        async exists(phone) {
          const [found] = (await sock.onWhatsApp(phone)) ?? []
          return found?.exists ? found.jid : null
        },
        async older(count, oldest, at) {
          await sock.fetchMessageHistory(count, oldest, at)
        },
        create: (subject, people) => sock.groupCreate(subject, people),
        logOut: () => sock.logout(),
        close: () => sock.end(undefined),
      }
    },
    fresh: () => baileys.initAuthCreds(),
    bytes: buffered,
    revive: (type, value) =>
      type === 'app-state-sync-key' && typeof value === 'object' && value !== null
        ? proto.Message.AppStateSyncKeyData.fromObject(value)
        : value,
    encode: (message) => proto.WebMessageInfo.encode(message).finish(),
    decode: (bytes) => proto.WebMessageInfo.decode(bytes),
    votes: (message, me) =>
      baileys.getAggregateVotesInPollMessage(
        { message: message.message ?? null, pollUpdates: message.pollUpdates ?? [] },
        me,
      ),
    vote(poll, names, me) {
      const secret = poll.message?.messageContextInfo?.messageSecret
      const id = poll.key.id
      if (!secret || !id) throw new Error('That poll no longer takes votes')
      const selected = names.map((name) => baileys.sha256(Buffer.from(name)))
      const payload = proto.Message.PollVoteMessage.encode({ selectedOptions: selected }).finish()
      const creator = baileys.getKeyAuthor(poll.key, me)
      const sign = Buffer.concat([
        Buffer.from(id),
        Buffer.from(creator),
        Buffer.from(me),
        Buffer.from('Poll Vote'),
        Buffer.from([1]),
      ])
      const key = baileys.hmacSign(sign, baileys.hmacSign(secret, new Uint8Array(32)))
      const iv = Buffer.from(crypto.getRandomValues(new Uint8Array(12)))
      const encPayload = baileys.aesEncryptGCM(payload, key, iv, Buffer.from(`${id}\u0000${me}`))
      return {
        message: {
          pollUpdateMessage: {
            pollCreationMessageKey: poll.key,
            vote: { encPayload, encIv: iv },
            senderTimestampMs: Date.now(),
          },
        },
        selected,
      }
    },
  }
}
