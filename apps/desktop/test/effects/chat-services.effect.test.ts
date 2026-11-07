import 'fake-indexeddb/auto'
import { mount, unmount } from 'svelte'
import { expect, test, vi } from 'vitest'

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  },
)

const { fakeProvider, SEND_ONLY } = await import('@orden/chats/fake-provider')
const { mailProvider } = await import('@orden/chats/mail')
const { FakeMail, nodeSocket } = await import('@orden/chats/mail-fake')
const { connected } = await import('../../src/lib/chats/connected.svelte')
const { conversationKey } = await import('../../src/lib/chats/conversation-key')
const ChatTab = (await import('../../src/lib/chats/view/ChatTab.svelte')).default

const host = {
  secret: () => Promise.resolve(null),
  keepSecret: () => Promise.resolve(),
  fetch: globalThis.fetch,
  now: () => Date.now(),
}

async function shown(options: Parameters<typeof fakeProvider>[0], conversation: string) {
  const fake = fakeProvider(options)
  const linked = await connected.link(fake, { name: fake.id }, host)
  const text = conversationKey({ provider: fake.id, account: linked.account.id, conversation })
  const target = document.body.appendChild(document.createElement('div'))
  const tab = { id: fake.id, kind: 'channel', path: null, note: { shared: null, text, name: '' } }
  const drawn = mount(ChatTab, { target, props: { tab: tab as never } })
  await vi.waitFor(() => expect(target.querySelectorAll('.message').length).toBeGreaterThan(2))
  const labelled = (label: string) => !!target.querySelector(`button[aria-label="${label}"]`)
  return { target, drawn, labelled }
}

test("a service that does everything gets every control of Orden's chat view", async () => {
  const { target, drawn, labelled } = await shown({ id: 'everything' }, 'team')
  for (const label of [
    'Members',
    'Pinned',
    'Notifications',
    'Search this chat',
    'Attach something',
    'Voice message',
  ])
    expect(labelled(label), label).toBe(true)
  expect(target.querySelector('.poll')).not.toBeNull()
  expect(target.querySelector('.reactions')).not.toBeNull()
  expect(target.querySelector('button.replies')).not.toBeNull()
  void unmount(drawn)
})

test('a service that only sends shows no control it cannot honour', async () => {
  const { target, drawn, labelled } = await shown(
    { id: 'little', can: SEND_ONLY, methods: [] },
    'team',
  )
  for (const label of [
    'Members',
    'Pinned',
    'Notifications',
    'Search this chat',
    'Attach something',
    'Voice message',
  ])
    expect(labelled(label), label).toBe(false)
  expect(target.querySelector('button.replies')).toBeNull()
  expect(target.querySelector('.reactions .more')).toBeNull()
  void unmount(drawn)
})

test('a mail thread opens in the same chat view, with its subject and without what mail cannot do', async () => {
  const server = new FakeMail()
  await server.listen()
  const mail = (lines: string[]) => lines.join('\n')
  server.deliver(
    'INBOX',
    mail([
      'From: Lucile <lucile@example.org>',
      'To: emil@example.org',
      'Subject: Lunch',
      'Date: Mon, 2 Nov 2026 10:00:00 +0000',
      'Message-ID: <lunch@example.org>',
      '',
      'At noon?',
    ]),
  )
  server.deliver(
    'INBOX',
    mail([
      'From: Lucile <lucile@example.org>',
      'To: emil@example.org',
      'Subject: Re: Lunch, and the room',
      'Date: Mon, 2 Nov 2026 10:02:00 +0000',
      'Message-ID: <room@example.org>',
      'In-Reply-To: <lunch@example.org>',
      'References: <lunch@example.org>',
      '',
      'Room 4, by the window.',
    ]),
  )
  server.deliver(
    'Sent',
    mail([
      'From: Emil <emil@example.org>',
      'To: Lucile <lucile@example.org>',
      'Subject: Re: Lunch',
      'Date: Mon, 2 Nov 2026 10:05:00 +0000',
      'Message-ID: <answer@example.org>',
      'In-Reply-To: <room@example.org>',
      'References: <lunch@example.org> <room@example.org>',
      '',
      'Yes!',
    ]),
    ['\\Seen'],
  )
  const linked = await connected.link(
    mailProvider,
    {
      address: 'emil@example.org',
      name: 'Emil',
      password: 'right horse',
      imapHost: '127.0.0.1',
      imapPort: String(server.imapPort),
      imapSecurity: 'none',
      smtpHost: '127.0.0.1',
      smtpPort: String(server.smtpPort),
      smtpSecurity: 'none',
    },
    { ...host, socket: nodeSocket },
  )
  const lunch = linked.conversations.find((one) => one.title === 'Lunch')
  expect(lunch).toBeDefined()
  const text = conversationKey({
    provider: mailProvider.id,
    account: linked.account.id,
    conversation: lunch?.id ?? '',
  })
  const target = document.body.appendChild(document.createElement('div'))
  const tab = { id: 'mail', kind: 'channel', path: null, note: { shared: null, text, name: '' } }
  const drawn = mount(ChatTab, { target, props: { tab: tab as never } })
  await vi.waitFor(() => expect(target.querySelectorAll('.message').length).toBe(3), {
    timeout: 5000,
  })
  const rows = [...target.querySelectorAll('.message')].map((one) => one.textContent)
  expect(rows.some((one) => one.includes('At noon?'))).toBe(true)
  expect(rows.some((one) => one.includes('Yes!'))).toBe(true)
  expect([...target.querySelectorAll('.subject')].map((one) => one.textContent)).toEqual([
    'Re: Lunch, and the room',
  ])
  const labelled = (label: string) => !!target.querySelector(`button[aria-label="${label}"]`)
  expect(labelled('Attach something')).toBe(true)
  for (const label of ['Voice message', 'Pinned', 'Members', 'Search this chat'])
    expect(labelled(label), label).toBe(false)
  expect(target.querySelector('button.replies')).toBeNull()
  expect(target.querySelector('.reactions')).toBeNull()
  void unmount(drawn)
  await connected.unlink(mailProvider.id, linked.account.id)
  await server.close()
})
