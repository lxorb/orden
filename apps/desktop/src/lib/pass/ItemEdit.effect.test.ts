import 'fake-indexeddb/auto'
import { blank } from '@orden/pass/envelope'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

vi.mock('../ai/keys', () => ({
  keysAreGuarded: () => false,
  readSecret: () => Promise.resolve(null),
  writeSecret: () => Promise.resolve(),
  forgetKey: () => Promise.resolve(),
}))

vi.mock('../protect/device', () => ({
  deviceCan: () => Promise.resolve(false),
  deviceSays: () => Promise.resolve(false),
  deviceName: () => 'Touch ID',
}))

const { configurePass, pass } = await import('./store.svelte')
const { PassUi } = await import('./ui.svelte')
const ItemEdit = (await import('./ItemEdit.svelte')).default

const FAST = { m: 64, t: 1, p: 1 }
configurePass({ kdf: FAST, pinKdf: FAST })

let target: HTMLElement
let shown: ReturnType<typeof mount> | undefined

beforeAll(async () => {
  await pass.start()
  if (pass.state === 'new') await pass.setup('correct horse battery staple')
})

afterEach(() => {
  if (shown) void unmount(shown)
  shown = undefined
  target.remove()
})

function shownWith(ui: InstanceType<typeof PassUi>) {
  target = document.createElement('div')
  document.body.append(target)
  shown = mount(ItemEdit, { target, props: { ui }, intro: false })
  flushSync()
}

function typed(field: HTMLInputElement | null, text: string) {
  if (!field) throw new Error('no field')
  field.value = text
  field.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

function saveButton(): HTMLButtonElement {
  const button = target.querySelector<HTMLButtonElement>('button[type="submit"]')
  if (!button) throw new Error('no save')
  return button
}

async function saved(ui: InstanceType<typeof PassUi>) {
  target.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }))
  await vi.waitFor(() => expect(ui.editing).toBeNull())
  flushSync()
}

describe('editing an item', () => {
  test('cannot save without a title', async () => {
    const ui = new PassUi(null)
    await ui.newItem(blank('login'))
    shownWith(ui)
    expect(saveButton().disabled).toBe(true)
    typed(target.querySelector('input.is-big'), 'Bank')
    expect(saveButton().disabled).toBe(false)
    expect(ui.dirty).toBe(true)
  })

  test('creates a login, then changes it', async () => {
    const ui = new PassUi(null)
    await ui.newItem(blank('login'))
    shownWith(ui)
    typed(target.querySelector('input.is-big'), 'Mail')
    typed(target.querySelector('input[autocomplete="new-password"]'), 'hunter2-very-secret')
    await saved(ui)

    const made = pass.items.find((one) => one.content.title === 'Mail')
    expect(made?.content.kind === 'login' && made.content.password).toBe('hunter2-very-secret')
    expect(ui.view.item).toBe(made?.id)

    if (shown) void unmount(shown)
    target.remove()
    if (!made) throw new Error('not made')
    await ui.edit(made.id)
    shownWith(ui)
    const title = target.querySelector<HTMLInputElement>('input.is-big')
    expect(title?.value).toBe('Mail')
    expect(ui.dirty).toBe(false)
    typed(title, 'Mail at work')
    await saved(ui)

    const changed = pass.items.find((one) => one.id === made.id)
    expect(changed?.content.title).toBe('Mail at work')
    expect(changed?.rev).toBeGreaterThan(made.rev)
  })

  test('says a 2FA secret it cannot read', async () => {
    const ui = new PassUi(null)
    await ui.newItem(blank('login'))
    shownWith(ui)
    const fields = [...target.querySelectorAll<HTMLInputElement>('input[type="password"]')]
    const secret = fields.find((one) => one.autocomplete !== 'new-password') ?? null
    typed(secret, 'not a secret!')
    expect(secret?.getAttribute('aria-invalid')).toBe('true')
    expect(target.querySelector('[role="alert"]')).not.toBeNull()
  })
})
