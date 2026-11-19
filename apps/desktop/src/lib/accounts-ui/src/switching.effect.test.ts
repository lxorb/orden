import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { settle } from '../../../../test/effects/settle'

const server = vi.hoisted(() => ({ held: [] as { token: string; go: () => void }[] }))
vi.mock('../../accounts/src/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../accounts/src/api')>()
  const later = <T>(token: string, value: T) =>
    new Promise<T>((done) => server.held.push({ token, go: () => done(value) }))
  return {
    ...original,
    api: {
      ...original.api,
      second: (token: string) => later(token, { possible: true, on: false, codesLeft: 0 }),
      sessions: (token: string) =>
        Promise.resolve({
          sessions: [{ id: `s-${token}`, name: `Laptop of ${token}`, createdAt: 0, lastUsedAt: null, current: true }],
        }),
    },
    request: (_path: string, options: { token: string }) =>
      later(options.token, { email: `${options.token}@example.org`, second: `${options.token}-too@example.org` }),
  }
})
const { account } = await import('../../accounts/src/api')
const Security = (await import('./Security.svelte')).default
const Addresses = (await import('./Addresses.svelte')).default
let target: HTMLElement
let close: (() => void) | undefined
const as = (token: string) => {
  account.token = token
  account.user = { id: token, email: `${token}@example.org`, name: token }
  flushSync()
}
async function answer(token: string) {
  for (const one of server.held.filter((held) => held.token === token)) one.go()
  server.held = server.held.filter((held) => held.token !== token)
  await settle()
}
beforeEach(() => {
  server.held = []
  as('ada')
  target = document.createElement('div')
  document.body.append(target)
})
afterEach(() => {
  close?.()
  close = undefined
  target.remove()
})
function draw(component: typeof Security) {
  const shown = mount(component, { target, intro: false })
  close = () => void unmount(shown)
  flushSync()
}
describe('another account signing in while Settings is open', () => {
  test('sees its own sessions, never the last account’s arriving late', async () => {
    draw(Security)
    as('bo')
    await answer('bo')
    await answer('ada')
    expect(target.textContent).toContain('Laptop of bo')
    expect(target.textContent).not.toContain('Laptop of ada')
  })
  test('sees its own second address, never the last account’s arriving late', async () => {
    draw(Addresses)
    as('bo')
    await answer('bo')
    await answer('ada')
    expect(target.textContent).toContain('bo-too@example.org')
    expect(target.textContent).not.toContain('ada-too@example.org')
  })
  test('starts without the address the last account was typing', async () => {
    draw(Addresses)
    await answer('ada')
    target.querySelector<HTMLButtonElement>('button[aria-label="Change email"]')?.click()
    flushSync()
    expect(target.querySelector('form.adding')).not.toBeNull()
    as('bo')
    await vi.waitFor(() => expect(target.querySelector('form.adding')).toBeNull())
  })
})
