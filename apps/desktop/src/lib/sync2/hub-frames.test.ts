/** What the hub says, read at the boundary: each frame the hub sends comes back typed,
 *  and anything else - the beat's answer, a frame of the wrong shape, one this version
 *  does not speak - comes back as nothing. */

import { describe, expect, test } from 'vitest'
import { BEAT_ANSWER, readHubFrame } from './hub-frames'

describe('readHubFrame', () => {
  test('reads every frame the hub sends', () => {
    const frames = [{ t: 'poke', space: 's1', seq: 3 }, { t: 'terms' }, { t: 'ai' }]
    for (const frame of frames) expect(readHubFrame(JSON.stringify(frame))).toEqual(frame)
  })

  test('hands a chat’s poke on whole, for the chats to read', () => {
    const poke = {
      t: 'chat',
      chat: `c_${'1'.repeat(32)}`,
      seq: 4,
      at: 9,
      by: 'user:a',
      mention: true,
    }
    expect(readHubFrame(JSON.stringify(poke))).toEqual({ t: 'chat', said: poke })
  })

  test('drops the beat’s answer and anything that is not a frame', () => {
    for (const said of [BEAT_ANSWER, '', 'null', '[]', '{}', '{"t":"nothing"}']) {
      expect(readHubFrame(said)).toBeNull()
    }
  })

  test('drops a poke of the wrong shape, and the web logins’ frames of hubs from before #393', () => {
    expect(readHubFrame(JSON.stringify({ t: 'poke', space: 's1', seq: -1 }))).toBeNull()
    expect(readHubFrame(JSON.stringify({ t: 'free', key: 'a'.repeat(64) }))).toBeNull()
    expect(readHubFrame(JSON.stringify({ t: 'key-asked' }))).toBeNull()
  })
})
