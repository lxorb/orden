import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

const vault = new Map<string, string>()
vi.mock('../../src/lib/ai/keys', () => ({
  readSecret: (name: string) => Promise.resolve(vault.get(name) ?? null),
  writeSecret: (name: string, value: string) => Promise.resolve(void vault.set(name, value)),
  forgetKey: (name: string) => Promise.resolve(void vault.delete(name)),
}))

const opened: string[] = []
vi.mock('../../src/lib/tauri', async (original) => ({
  ...(await original<typeof import('../../src/lib/tauri')>()),
  openExternal: (url: string) => Promise.resolve(void opened.push(url)),
}))

const { fakeProvider } = await import('@orden/chats/fake-provider')
const { connected } = await import('../../src/lib/chats/connected.svelte')
const { accounts } = await import('../../src/lib/chats/linked')
const { CHATS_WORD, hiddenKinds } = await import('../../src/lib/settings.svelte')
hiddenKinds.hidden = [CHATS_WORD]
const { adding } = await import('../../src/lib/chats/view/adding.svelte')
const AddChat = (await import('../../src/lib/chats/view/AddChat.svelte')).default

let drawn: ReturnType<typeof mount> | null = null

afterEach(() => {
  if (drawn) void unmount(drawn)
  drawn = null
  adding.again = null
  document.body.innerHTML = ''
})

function open(): HTMLElement {
  const target = document.body.appendChild(document.createElement('div'))
  drawn = mount(AddChat, { target })
  flushSync()
  return target
}

function typeInto(field: HTMLInputElement, words: string) {
  field.value = words
  field.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

function tile(target: HTMLElement, name: string): HTMLButtonElement {
  const found = [...target.querySelectorAll<HTMLButtonElement>('.tile')].find(
    (one) => one.querySelector('.tile-name')?.textContent === name,
  )
  if (!found) throw new Error(`no tile for ${name}`)
  return found
}

const step = (target: HTMLElement) => target.querySelector('.add-chat')?.getAttribute('data-step')
const submit = (target: HTMLElement) =>
  target.querySelector<HTMLButtonElement>('button[type="submit"]')

test('a service is chosen from tiles, its warning accepted, its code asked for, and it ends on the chats to open', async () => {
  accounts.offer(
    fakeProvider({
      id: 'risky',
      name: 'Risky',
      signIn: 'code',
      warning: 'This may get your account banned.',
    }),
  )
  accounts.offer(fakeProvider({ id: 'plain', name: 'Plain' }))
  const target = open()
  expect(step(target)).toBe('choose')
  expect(target.querySelectorAll('.tile svg').length).toBe(target.querySelectorAll('.tile').length)
  tile(target, 'Risky').click()
  flushSync()

  expect(step(target)).toBe('connect')
  expect(target.querySelector('input[type="tel"]')).not.toBeNull()
  expect(target.querySelector('.note')?.textContent).toContain('nothing leaves this device')
  for (const field of target.querySelectorAll<HTMLInputElement>('input.orden-field'))
    typeInto(field, '+41790000000')
  expect(adding.entered).toBe(true)
  expect(target.querySelector('.warning')?.textContent).toContain('banned')
  expect(submit(target)?.disabled).toBe(true)
  target.querySelector<HTMLInputElement>('.understood input')?.click()
  flushSync()
  expect(submit(target)?.disabled).toBe(false)

  submit(target)?.click()
  await vi.waitFor(() => expect(target.querySelector('.ask')).not.toBeNull())
  expect(step(target)).toBe('check')
  expect(adding.busy).toBe(true)
  const code = target.querySelector<HTMLInputElement>('.ask input')
  expect(code?.getAttribute('autocomplete')).toBe('one-time-code')
  if (code) typeInto(code, '12345')
  target.querySelector<HTMLButtonElement>('.ask button[type="submit"]')?.click()
  await vi.waitFor(() => expect(step(target)).toBe('done'))
  expect(connected.linked.some((one) => one.provider.id === 'risky')).toBe(true)
  expect(target.querySelector('h2')?.textContent).toContain('is connected')
  expect(adding.entered).toBe(false)
})

test('a failed check says why and how to fix it, and Back keeps what was entered', async () => {
  accounts.offer(fakeProvider({ id: 'wrong', name: 'Wrong', signIn: 'code' }))
  const target = open()
  tile(target, 'Wrong').click()
  flushSync()
  const fields = [...target.querySelectorAll<HTMLInputElement>('input.orden-field')]
  for (const field of fields) typeInto(field, 'kept')
  submit(target)?.click()
  await vi.waitFor(() => expect(target.querySelector('.ask')).not.toBeNull())
  const code = target.querySelector<HTMLInputElement>('.ask input')
  if (code) typeInto(code, '00000')
  target.querySelector<HTMLButtonElement>('.ask button[type="submit"]')?.click()
  await vi.waitFor(() => expect(target.querySelector('.failed')).not.toBeNull())
  const failed = target.querySelector('.failed')
  expect(failed?.getAttribute('role')).toBe('alert')
  expect(failed?.textContent).toContain('wrong code')
  expect(failed?.querySelectorAll('p').length).toBe(2)
  target.querySelector<HTMLButtonElement>('[aria-label="Back"]')?.click()
  flushSync()
  expect(step(target)).toBe('connect')
  expect(
    [...target.querySelectorAll<HTMLInputElement>('input.orden-field')].map((one) => one.value),
  ).toEqual(['kept', 'kept'])
})

test('cancelling while a code is asked goes back to the details without an error', async () => {
  accounts.offer(fakeProvider({ id: 'asks', name: 'Asks', signIn: 'code' }))
  const target = open()
  tile(target, 'Asks').click()
  flushSync()
  for (const field of target.querySelectorAll<HTMLInputElement>('input.orden-field'))
    typeInto(field, '+1')
  submit(target)?.click()
  await vi.waitFor(() => expect(target.querySelector('.ask')).not.toBeNull())
  const stop = [...target.querySelectorAll<HTMLButtonElement>('.body > .actions button')].at(-1)
  stop?.click()
  await vi.waitFor(() => expect(step(target)).toBe('connect'))
  expect(target.querySelector('.ask')).toBeNull()
  expect(target.querySelector('[role="alert"]')).toBeNull()
  expect(adding.busy).toBe(false)
})

test('a QR code is drawn in the check step while the service waits to be paired', async () => {
  const fake = fakeProvider({ id: 'pairs', name: 'Pairs', signIn: 'qr' })
  accounts.offer(fake)
  const target = open()
  tile(target, 'Pairs').click()
  flushSync()
  for (const field of target.querySelectorAll<HTMLInputElement>('input.orden-field'))
    typeInto(field, 'x')
  submit(target)?.click()
  await vi.waitFor(() => expect(target.querySelector('.square svg')).not.toBeNull())
  expect(step(target)).toBe('check')
  fake.world.pair()
  await vi.waitFor(() => expect(step(target)).toBe('done'))
  expect(target.querySelector('.square')).toBeNull()
  expect(vault.size).toBeGreaterThan(0)
})

test('Escape goes back from the details to the tiles, keeping nothing', () => {
  accounts.offer(fakeProvider({ id: 'esc', name: 'Esc' }))
  const target = open()
  tile(target, 'Esc').click()
  flushSync()
  target
    .querySelector('.add-chat')
    ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  flushSync()
  expect(step(target)).toBe('choose')
  expect(adding.entered).toBe(false)
})

test('a field that needs something made elsewhere says how, in steps and a link that opens outside', () => {
  const plain = fakeProvider({ id: 'helped', name: 'Helped' })
  accounts.offer({
    ...plain,
    fields: [
      {
        key: 'clientId',
        label: 'Client ID',
        kind: 'text' as const,
        help: {
          url: 'https://example.org/apps',
          label: 'How to get one',
          steps: ['Make an app', 'Copy its ID'],
        },
      },
    ],
  })
  const target = open()
  tile(target, 'Helped').click()
  flushSync()
  const guide = target.querySelector('.guide')
  expect(guide?.querySelector('.guide-title')?.textContent).toBe('How to get one')
  expect([...(guide?.querySelectorAll('li') ?? [])].map((one) => one.textContent)).toEqual([
    'Make an app',
    'Copy its ID',
  ])
  guide?.querySelector<HTMLButtonElement>('button')?.click()
  expect(opened).toEqual(['https://example.org/apps'])
})

test('signing in again starts on that account’s details, with what it kept filled in', async () => {
  const again = fakeProvider({ id: 'back', name: 'Back' })
  accounts.offer(again)
  expect(await accounts.connect('back', { name: 'wren' })).toBeNull()
  const account = connected.linked.find((one) => one.provider.id === 'back')?.account.id ?? ''
  adding.again = { provider: 'back', account }
  const target = open()
  expect(step(target)).toBe('connect')
  expect(target.querySelector('.tile')).toBeNull()
  expect(target.querySelector('[aria-label="Back"]')).toBeNull()
  expect(target.querySelector<HTMLInputElement>('input.orden-field')?.value).toBe('wren')
})

test('the sidebar keeps no form of its own to connect with', () => {
  const panel = readFileSync(
    join(import.meta.dirname, '../../src/lib/chats/view/ChatsPanel.svelte'),
    'utf8',
  )
  expect(panel).not.toMatch(/<form|ConnectForm|type="password"/)
  expect(panel).toContain('addChat()')
})
