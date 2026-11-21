import { expect, test } from 'vitest'
import { chatsOn, KINDS_KEY } from '../../gates/src/api'
import { workspace } from '../../workspace/src/api'
import { demoChats } from './demo'
import { ChatPage } from './view/chat.svelte'
import { store } from './view/source.svelte'

test('a demo plays a chat of its own people in memory, opens it in a tab, and leaves the kept settings alone (#2407)', async () => {
  const kept = localStorage.getItem(KINDS_KEY)
  const demo = demoChats({ id: 'ana', name: 'Ana' })
  const path = demo.add('/Launch', 'launch', [{ id: 'ben', name: 'Ben Ortiz' }])
  expect(path).toBe('/Launch/launch.chat')
  const chat = await store().chatAt(path)
  expect(chat).not.toBe(null)
  const page = new ChatPage(chat ?? '')
  await new Promise((done) => setTimeout(done, 0))
  expect(page.members.map((one) => one.name)).toEqual(['Ana', 'Ben Ortiz'])
  demo.typing(path, 'ben', true)
  expect(page.view.presence.typing.map((one) => one.who)).toEqual(['user:ben'])
  const said = demo.say(path, 'ben', 'The launch notes are in **Plan**')
  demo.typing(path, 'ben', false)
  expect(page.messages.at(-1)).toMatchObject({ id: said, author: 'user:ben', body: 'The launch notes are in **Plan**' })
  expect(page.view.presence.typing).toEqual([])
  demo.react(path, said ?? '', 'ana', '🎉')
  demo.react(path, said ?? '', 'ben', '🎉')
  expect(page.messages.find((one) => one.id === said)?.reactions).toEqual({ '🎉': ['user:ana', 'user:ben'] })
  const shot = demo.picture(path, 'ben', '/demo/launch.png', { width: 800, height: 600, caption: 'The new page' })
  const posted = page.messages.find((one) => one.id === shot)
  expect(posted).toMatchObject({ author: 'user:ben', body: 'The new page' })
  expect(posted?.files[0]).toMatchObject({ name: 'launch.png', type: 'image/png', width: 800, height: 600 })
  expect(await store().fileUrl(chat ?? '', posted?.files[0]?.hash ?? '')).toBe('/demo/launch.png')
  expect(demo.say('/Launch/nowhere.chat', 'ben', 'lost')).toBe(null)
  page.close()
  expect(chatsOn()).toBe(true)
  expect(localStorage.getItem(KINDS_KEY)).toBe(kept)
  demo.open(path)
  expect(workspace.tabs.find((one) => one.path === path)?.kind).toBe('channel')
})
