import type { Message, Who } from '@orden/chats'
import { beforeEach, expect, test, vi } from 'vitest'

const ME: Who = 'user:me'
const ANA: Who = 'user:ana'
const BEN: Who = 'user:ben'
const world = vi.hoisted(() => ({
  blocked: [] as string[],
  down: false,
  asked: [] as string[],
  kept: new Map<string, string>(),
}))
vi.stubGlobal('localStorage', {
  getItem: (key: string) => world.kept.get(key) ?? null,
  setItem: (key: string, value: string) => void world.kept.set(key, value),
  removeItem: (key: string) => void world.kept.delete(key),
})
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isNative: false,
  isDesktop: false,
  invoke: () => Promise.resolve(),
}))
const { Account, CHAT } = await import('./test-account')
const server = new Account()
const remote = server.remote(ME, () => true)
vi.mock('./http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http')>()),
  listChats: () => remote.list(),
  eventsOf: (chat: string, where: { after?: number }) => remote.events(chat, where.after ?? 0),
  stateOf: (chat: string, before?: number) => remote.state(chat, before),
  sendEvents: (chat: string, events: never[]) => remote.post(chat, events),
  postRead: () => Promise.resolve(true),
  membersOf: () => Promise.resolve([]),
  searchOnAccount: () => Promise.resolve([...server.state().values()].map((message) => ({ chat: CHAT, message }))),
  listBlocks: () => Promise.resolve(world.down ? null : [...world.blocked]),
  putBlock: (who: string) => {
    world.asked.push(`put ${who}`)
    if (!world.down) world.blocked.push(who)
    return Promise.resolve(!world.down)
  },
  dropBlock: (who: string) => {
    world.asked.push(`drop ${who}`)
    if (!world.down) world.blocked = world.blocked.filter((one) => one !== who)
    return Promise.resolve(!world.down)
  },
}))
const { account } = await import('../../accounts/src/api')
const { chats } = await import('./store.svelte')
let made = 0
const say = (who: Who, body: string, more: Record<string, unknown> = {}) => {
  made += 1
  server.place(who, { kind: 'post', id: `e${String(made)}`, message: `m${String(made)}`, body, ...more })
  return `m${String(made)}`
}
async function until(check: () => boolean): Promise<void> {
  for (let tries = 0; tries < 200 && !check(); tries++) await new Promise((settle) => setTimeout(settle, 5))
  expect(check()).toBe(true)
}
const bodies = (messages: readonly Message[]) => messages.map((one) => one.body)
let mine = ''
beforeEach(async () => {
  Object.assign(account, { user: { id: 'me', email: 'me@example.com', name: 'Me' }, token: 'session' })
  await chats.start(null)
  await chats.forget()
  world.blocked = []
  world.down = false
  world.asked = []
  world.kept.clear()
  if (!mine) {
    say(ANA, 'Morning')
    mine = say(ME, 'Lunch?')
    say(BEN, 'Buy my course')
    server.place(ANA, { kind: 'react', id: 'r1', target: mine, emoji: '👍', on: true })
    server.place(BEN, { kind: 'react', id: 'r2', target: mine, emoji: '👍', on: true })
  }
  await chats.start('me')
})
test('blocking somebody asks the account, and at once hides what they wrote and gave in an open chat', async () => {
  const view = chats.open(CHAT)
  await until(() => view.messages.length === 3)
  expect(await chats.block(BEN)).toBe(true)
  expect(world.asked).toEqual([`put ${BEN}`])
  await until(() => view.messages.length === 2)
  expect(bodies(view.messages)).toEqual(['Morning', 'Lunch?'])
  expect(view.messages[1]?.reactions).toEqual({ '👍': [ANA] })
  expect([chats.blocked, chats.hides(BEN), chats.hides(ANA)]).toEqual([[BEN], true, false])
  view.close()
})
test('taking the block off brings everything back', async () => {
  const view = chats.open(CHAT)
  await chats.block(BEN)
  await until(() => view.messages.length === 2)
  expect(await chats.unblock(BEN)).toBe(true)
  await until(() => view.messages.length === 3)
  expect(view.messages[1]?.reactions).toEqual({ '👍': [ANA, BEN] })
  view.close()
})
test('what a blocked person wrote is not counted as unread, not found by a search and not heard as new', async () => {
  const view = chats.open(CHAT)
  await until(() => chats.entry(CHAT)?.unread === 2)
  await chats.block(BEN)
  await until(() => chats.entry(CHAT)?.unread === 1)
  expect(bodies((await chats.search('course')).map((one) => one.message))).not.toContain('Buy my course')
  expect(await chats.message(CHAT, 'm3')).toBeNull()
  const heard: string[] = []
  const stop = chats.heard((_chat, messages) => heard.push(...bodies(messages)))
  say(BEN, 'Last chance')
  say(ANA, 'See you at one')
  await chats.reconnected()
  await until(() => heard.includes('See you at one'))
  expect(heard).toEqual(['See you at one'])
  stop()
  view.close()
})
test('the list of blocked people comes from the account, so another device’s block hides here too', async () => {
  world.blocked = [BEN]
  await chats.reconnected()
  await until(() => chats.hides(BEN))
  const view = chats.open(CHAT)
  await until(() => view.messages.length > 0)
  expect(bodies(view.messages)).not.toContain('Buy my course')
  view.close()
})
test('with no network the last known list still hides, and a block the account did not take hides nothing', async () => {
  await chats.block(BEN)
  await chats.start(null)
  world.down = true
  await chats.start('me')
  expect(chats.hides(BEN)).toBe(true)
  expect(await chats.block(ANA)).toBe(false)
  expect(chats.hides(ANA)).toBe(false)
  expect(await chats.unblock(BEN)).toBe(false)
  expect(chats.hides(BEN)).toBe(true)
})
test('nobody blocks themselves', async () => {
  expect(await chats.block(ME)).toBe(false)
  expect(world.asked).toEqual([])
})
