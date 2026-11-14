import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { PassBubble } from './fill-bubble'

const fake = vi.hoisted(() => ({
  state: 'open',
  calls: [] as unknown[][],
}))

vi.mock('./autofill', () => {
  const said =
    (name: string) =>
    (...args: unknown[]) => {
      fake.calls.push([name, ...args])
      return Promise.resolve()
    }
  return {
    autofill: {
      choose: said('choose'),
      generate: said('generate'),
      alias: said('alias'),
      reoffer: said('reoffer'),
      save: said('save'),
      never: said('never'),
      stop: said('stop'),
      dismiss: said('dismiss'),
    },
  }
})

vi.mock('./open', () => ({
  openPass: () => fake.calls.push(['openPass']),
}))

vi.mock('./store.svelte', () => ({
  pass: {
    get state() {
      return fake.state
    },
  },
}))

const PassFill = (await import('./PassFill.svelte')).default
const { overlays } = await import('../ui-kit/src/overlays')

const TAB = 'tab-1'

let target: HTMLElement
let shown: ReturnType<typeof mount> | undefined

beforeEach(() => {
  fake.calls = []
  fake.state = 'open'
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  if (shown) void unmount(shown)
  shown = undefined
  target.remove()
})

function showing(bubble: PassBubble) {
  shown = mount(PassFill, { target, props: { bubble }, intro: false })
  flushSync()
}

function press(words: string) {
  const button = [...target.querySelectorAll('button')].find((one) =>
    one.textContent.includes(words),
  )
  if (!button) throw new Error(`no button saying ${words}`)
  button.click()
  flushSync()
}

const CHOOSE: PassBubble = {
  kind: 'choose',
  tab: TAB,
  site: 'bank.com',
  formKind: 'signup',
  logins: [{ id: 'one', title: 'Bank', subtitle: 'alice' }],
  cards: [],
  identities: [],
  generate: true,
  alias: true,
  fields: [],
}

describe('the fill bubble', () => {
  test("lists the site's logins and fills the one chosen", () => {
    showing(CHOOSE)
    expect(target.textContent).toContain('bank.com')
    expect(target.textContent).toContain('alice')
    target.querySelector<HTMLButtonElement>('[data-pass-choice="one"]')?.click()
    expect(fake.calls).toEqual([['choose', TAB, 'one']])
  })

  test('offers a generated password on a sign-up form, and Pass itself', () => {
    showing(CHOOSE)
    press('Generate password')
    press('Use an alias')
    press('Open Pass')
    expect(fake.calls).toEqual([['generate', TAB], ['alias', TAB], ['dismiss', TAB], ['openPass']])
  })

  test('names the fields a card would fill before one is chosen', () => {
    showing({
      ...CHOOSE,
      formKind: 'card',
      logins: [],
      cards: [{ id: 'visa', title: 'Visa', subtitle: '•••• 1111' }],
      generate: false,
      alias: false,
      fields: ['cc-number', 'cc-exp', 'cc-csc'],
    })
    expect(target.querySelector('[data-pass-fields]')?.textContent.trim()).toBe(
      'Fills Card number, Expiry date, Security code',
    )
  })

  test('says when Pass has nothing for the site', () => {
    showing({ ...CHOOSE, logins: [], generate: false, alias: false })
    expect(target.textContent).toContain('Nothing in Pass for this site yet.')
    expect(target.textContent).not.toContain('Generate password')
  })

  test('while Pass is locked it only offers to unlock it', () => {
    fake.state = 'locked'
    showing({ kind: 'unlock', tab: TAB })
    expect(target.querySelectorAll('button')).toHaveLength(1)
    press('Unlock Pass')
    expect(fake.calls).toEqual([['dismiss', TAB], ['openPass']])
  })

  test('offers the choices again once Pass is unlocked', () => {
    showing({ kind: 'unlock', tab: TAB })
    expect(fake.calls).toEqual([['reoffer', TAB]])
  })

  test('asks to save a login, with Not now and Never for this site', () => {
    showing({ kind: 'save', tab: TAB, site: 'bank.com', username: 'alice', update: false })
    expect(target.textContent).toContain('Save login?')
    press('Never for this site')
    press('Not now')
    press('Save')
    expect(fake.calls).toEqual([
      ['never', TAB],
      ['dismiss', TAB],
      ['save', TAB],
    ])
  })

  test('asks to update a password, never to stop saving the site', () => {
    showing({ kind: 'save', tab: TAB, site: 'bank.com', username: 'alice', update: true })
    expect(target.textContent).toContain('Update password?')
    expect(target.textContent).not.toContain('Never for this site')
    press('Update')
    expect(fake.calls).toEqual([['save', TAB]])
  })

  test('says who is signing in, and Stop and Escape stop it', () => {
    showing({ kind: 'signing', tab: TAB, name: 'alice' })
    expect(target.textContent).toContain('Signing in as alice…')
    press('Stop')
    expect(overlays.escape()).toBe(true)
    expect(fake.calls).toEqual([
      ['stop', TAB],
      ['dismiss', TAB],
    ])
  })
})
