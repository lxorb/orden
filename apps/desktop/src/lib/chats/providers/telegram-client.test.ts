import type { tl } from '@mtcute/web'
import Long from 'long'
import { beforeEach, expect, test, vi } from 'vitest'

const handled: { updates: unknown; quiet: boolean | undefined }[] = []
let answer: unknown = null

vi.mock('@mtcute/web', () => ({
  MemoryStorage: class {},
  TelegramClient: class {
    onRawUpdate = { add() {}, remove() {} }
    onConnectionState = { add() {}, remove() {} }
    onError = { add() {}, remove() {} }
    connect() {
      return Promise.resolve()
    }
    call() {
      return Promise.resolve(answer)
    }
    handleClientUpdate(updates: unknown, quiet?: boolean) {
      handled.push({ updates, quiet })
    }
  },
}))

const { dial, ownUpdates } = await import('./telegram-client')

beforeEach(() => {
  handled.length = 0
})

const channel: tl.TypeInputChannel = {
  _: 'inputChannel',
  channelId: 45,
  accessHash: Long.ZERO,
}

test('the updates in an answer to our own call reach the update order quietly', async () => {
  const client = await dial({ apiId: 1, apiHash: 'x', session: null })
  answer = { _: 'updates', updates: [], users: [], chats: [], date: 1, seq: 0 }
  await client.call({ _: 'messages.editMessage', peer: { _: 'inputPeerSelf' }, id: 1 })
  answer = { _: 'messages.affectedMessages', pts: 9, ptsCount: 1 }
  await client.call({ _: 'channels.deleteMessages', channel, id: [1] })
  answer = true
  await client.call({
    _: 'messages.setTyping',
    peer: { _: 'inputPeerSelf' },
    action: { _: 'sendMessageTypingAction' },
  })
  expect(handled).toMatchObject([
    { updates: { _: 'updates' }, quiet: true },
    {
      updates: { updates: [{ _: 'mtcute.dummyUpdate', channelId: 45, pts: 9, ptsCount: 1 }] },
      quiet: true,
    },
  ])
})

test('a sent message and a read move the shared counter, other answers move nothing', () => {
  const sent = ownUpdates(
    { _: 'messages.readHistory', peer: { _: 'inputPeerSelf' }, maxId: 3 },
    { _: 'updateShortSentMessage', id: 5, pts: 12, ptsCount: 1, date: 1 },
  )
  expect(sent).toMatchObject({ updates: [{ channelId: 0, pts: 12, ptsCount: 1 }] })
  const read = ownUpdates(
    { _: 'messages.readHistory', peer: { _: 'inputPeerSelf' }, maxId: 3 },
    { _: 'messages.affectedMessages', pts: 13, ptsCount: 1 },
  )
  expect(read).toMatchObject({ updates: [{ channelId: 0, pts: 13 }] })
  expect(ownUpdates({ _: 'help.getConfig' }, { _: 'config' })).toBeNull()
  expect(ownUpdates({ _: 'help.getConfig' }, true)).toBeNull()
})
