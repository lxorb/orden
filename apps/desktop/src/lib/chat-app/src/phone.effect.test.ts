import { flushSync } from 'svelte'
import { expect, test } from 'vitest'
import { reactive } from '../../../../test/effects/runes.svelte'
import { ChatNav } from './nav.svelte'
import { watchPhone } from './phone.svelte'

const CHAT = `c_${'a'.repeat(32)}`
test('the phone is told the quiet times when they change, and to clear a chat’s notifications when it is opened', () => {
  const nav = new ChatNav()
  const hush = reactive({ previews: true })
  const told: boolean[] = []
  const cleared: string[] = []
  const stop = watchPhone(nav, {
    quiet: () => ({ hours: null, dndUntil: null, previews: hush.previews, sound: false }),
    tell: (quiet) => told.push(quiet.previews),
    clear: (chat) => cleared.push(chat),
  })
  flushSync()
  expect([told, cleared]).toEqual([[true], []])
  hush.previews = false
  nav.open(CHAT, 'home')
  flushSync()
  expect([told, cleared]).toEqual([[true, false], [CHAT]])
  stop()
  hush.previews = true
  flushSync()
  expect(told).toEqual([true, false])
})
