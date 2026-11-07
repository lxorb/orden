import 'fake-indexeddb/auto'
import { flushSync, mount, unmount } from 'svelte'
import { expect, test, vi } from 'vitest'

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
const ConnectForm = (await import('../../src/lib/chats/view/ConnectForm.svelte')).default

function typeInto(field: HTMLInputElement, words: string) {
  field.value = words
  field.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

test('a risky service is only connected once its warning is accepted, and its code is asked for', async () => {
  const risky = fakeProvider({
    id: 'risky',
    name: 'Risky',
    signIn: 'code',
    warning: 'This may get your account banned.',
  })
  const plain = fakeProvider({ id: 'plain', name: 'Plain' })
  accounts.offer(risky)
  accounts.offer(plain)
  const target = document.body.appendChild(document.createElement('div'))
  let finished = false
  const drawn = mount(ConnectForm, {
    target,
    props: { providers: [plain, risky], done: () => (finished = true) },
  })
  const services = [...target.querySelectorAll<HTMLButtonElement>('.service')]
  expect(services.map((one) => one.textContent)).toEqual(['Plain', 'Risky'])
  services[1]?.click()
  flushSync()

  const phone = target.querySelector<HTMLInputElement>('input[type="tel"]')
  expect(phone).not.toBeNull()
  expect(target.querySelector('.note')?.textContent).toContain('nothing leaves this device')
  for (const field of target.querySelectorAll<HTMLInputElement>('input.orden-field'))
    typeInto(field, '+41790000000')
  const go = target.querySelector<HTMLButtonElement>('button[type="submit"]')
  expect(target.querySelector('.warning')?.textContent).toContain('banned')
  expect(go?.disabled).toBe(true)
  const accept = target.querySelector<HTMLInputElement>('.understood input')
  accept?.click()
  flushSync()
  expect(go?.disabled).toBe(false)

  go?.click()
  await vi.waitFor(() => expect(target.querySelector('.ask')).not.toBeNull())
  const code = target.querySelector<HTMLInputElement>('.ask input')
  expect(code?.getAttribute('autocomplete')).toBe('one-time-code')
  if (code) typeInto(code, '12345')
  target.querySelector<HTMLButtonElement>('.ask button[type="submit"]')?.click()
  await vi.waitFor(() => expect(finished).toBe(true))
  expect(connected.linked.some((one) => one.provider.id === 'risky')).toBe(true)
  void unmount(drawn)
})

test('cancelling while a code is asked stops connecting without an error', async () => {
  const fake = fakeProvider({ id: 'asks', name: 'Asks', signIn: 'code' })
  accounts.offer(fake)
  const target = document.body.appendChild(document.createElement('div'))
  const drawn = mount(ConnectForm, { target, props: { providers: [fake], done: () => undefined } })
  for (const field of target.querySelectorAll<HTMLInputElement>('input.orden-field'))
    typeInto(field, '+1')
  target.querySelector<HTMLButtonElement>('button[type="submit"]')?.click()
  await vi.waitFor(() => expect(target.querySelector('.ask')).not.toBeNull())
  const cancel = [...target.querySelectorAll<HTMLButtonElement>('.actions button')].at(-2)
  cancel?.click()
  await vi.waitFor(() => expect(target.querySelector('.ask')).toBeNull())
  await vi.waitFor(() =>
    expect(target.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false),
  )
  expect(target.querySelector('[role="alert"]')).toBeNull()
  void unmount(drawn)
})

test('a QR code is drawn while the service waits to be paired', async () => {
  const fake = fakeProvider({ id: 'pairs', name: 'Pairs', signIn: 'qr' })
  accounts.offer(fake)
  const target = document.body.appendChild(document.createElement('div'))
  let finished = false
  const drawn = mount(ConnectForm, {
    target,
    props: { providers: [fake], done: () => (finished = true) },
  })
  for (const field of target.querySelectorAll<HTMLInputElement>('input.orden-field'))
    typeInto(field, 'x')
  target.querySelector<HTMLButtonElement>('button[type="submit"]')?.click()
  await vi.waitFor(() => expect(target.querySelector('.square svg')).not.toBeNull())
  fake.world.pair()
  await vi.waitFor(() => expect(finished).toBe(true))
  expect(target.querySelector('.square')).toBeNull()
  expect(vault.size).toBeGreaterThan(0)
  void unmount(drawn)
})

test('a field that needs something made elsewhere says how, in steps and a link that opens outside', () => {
  const plain = fakeProvider({ id: 'helped', name: 'Helped' })
  const helped = {
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
  }
  const target = document.body.appendChild(document.createElement('div'))
  const drawn = mount(ConnectForm, {
    target,
    props: { providers: [helped], done: () => undefined },
  })
  const help = target.querySelector('details.help')
  expect(help?.querySelector('summary')?.textContent).toBe('How to get one')
  expect([...(help?.querySelectorAll('li') ?? [])].map((one) => one.textContent)).toEqual([
    'Make an app',
    'Copy its ID',
  ])
  help?.querySelector<HTMLButtonElement>('button.link')?.click()
  expect(opened).toEqual(['https://example.org/apps'])
  void unmount(drawn)
})
