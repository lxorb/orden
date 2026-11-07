import 'fake-indexeddb/auto'
import { blank } from '@orden/pass/envelope'
import type { Card, Content, Identity, Login, Website } from '@orden/pass/types'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type {
  FieldRole,
  FillTarget,
  FormKind,
  PassForms,
  PassFrame,
  PassMark,
  PassSubmitted,
} from './channel'

const heard = vi.hoisted(() => ({
  forms: null as ((said: unknown) => void) | null,
  mark: null as ((said: unknown) => void) | null,
  submitted: null as ((said: unknown) => void) | null,
  filled: [] as { target: unknown; values: Record<string, string>; submit: boolean }[],
  fills: true,
  aliasFor: [] as (string | undefined)[],
}))

vi.mock('./new-alias', () => ({
  newAlias: (_prefix: string | undefined, hostname: string | undefined) => {
    heard.aliasFor.push(hostname)
    return Promise.resolve({
      id: 'alias-1',
      content: { kind: 'alias', address: 'quiet.fox@alias.example' },
    })
  },
}))

vi.mock('./channel', () => ({
  onForms: (then: (said: unknown) => void) => {
    heard.forms = then
    return Promise.resolve(() => undefined)
  },
  onMark: (then: (said: unknown) => void) => {
    heard.mark = then
    return Promise.resolve(() => undefined)
  },
  onSubmitted: (then: (said: unknown) => void) => {
    heard.submitted = then
    return Promise.resolve(() => undefined)
  },
  fill: (target: unknown, values: Record<string, string>, submit: boolean) => {
    heard.filled.push({ target, values, submit })
    return Promise.resolve(heard.fills)
  },
}))

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

const { forgetLocal } = await import('./local')
const { configurePass, PassStore } = await import('./store.svelte')
const { Autofill } = await import('./autofill')
const { passBubbles } = await import('./fill-bubbles.svelte')
const { FLOW_WINDOW } = await import('./sign-in-flow')
const { hiddenKinds, PASS_WORD } = await import('../settings.svelte')

configurePass({ kdf: { m: 64, t: 1, p: 1 }, pinKdf: { m: 64, t: 1, p: 1 } })

const TAB = 'tab-1'
const BANK = 'https://bank.com'
const SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const TOTP = `otpauth://totp/Bank:alice?secret=${SEED}&digits=8`

type Store = InstanceType<typeof PassStore>

let store: Store
let clock = 59_000

function made(pause = 0): InstanceType<typeof Autofill> {
  const autofill = new Autofill(store, () => clock, pause)
  void autofill.start()
  return autofill
}

function frameAt(url: string, more: Partial<PassFrame> = {}): PassFrame {
  return {
    tab: TAB,
    frame: 'main',
    origin: new URL(url).origin,
    url,
    secure: true,
    top: true,
    ...more,
  }
}

function formOf(form: string, kind: FormKind, roles: FieldRole[]) {
  return {
    form,
    kind,
    fields: roles.map((role, at) => ({ field: `e${form}${at}`, role, visible: true })),
  }
}

function forms(frame: PassFrame, kind: FormKind, roles: FieldRole[], form = '1'): PassForms {
  return { ...frame, forms: [formOf(form, kind, roles)] }
}

function site(url: string, match: Website['match'] = 'domain'): Website {
  return { url, match }
}

function login(more: Partial<Login>): Login {
  return { ...blank('login'), title: 'Bank', websites: [site(BANK)], ...more }
}

async function kept(content: Content) {
  const vault = store.vaults[0]
  if (!vault) throw new Error('no vault')
  return await store.create(vault.id, content)
}

async function said(event: 'forms' | 'mark' | 'submitted', what: unknown): Promise<void> {
  const then = heard[event]
  if (!then) throw new Error(`nobody hears ${event}`)
  then(what)
  await new Promise((done) => setTimeout(done, 20))
}

async function marked(frame: PassFrame, kind: FormKind, roles: FieldRole[]): Promise<void> {
  await said('forms', forms(frame, kind, roles))
  const mark: PassMark = { ...frame, form: '1', field: 'e10' }
  await said('mark', mark)
}

function submitted(frame: PassFrame, more: Partial<PassSubmitted>): PassSubmitted {
  return {
    ...frame,
    form: '1',
    kind: 'login',
    username: null,
    password: null,
    newPassword: null,
    ...more,
  }
}

function shown() {
  return passBubbles.of(TAB)
}

async function settled(count: number) {
  await vi.waitFor(() => expect(heard.filled).toHaveLength(count))
}

beforeEach(async () => {
  await forgetLocal()
  heard.filled = []
  heard.fills = true
  heard.aliasFor = []
  clock = 59_000
  hiddenKinds.hidden = [PASS_WORD]
  passBubbles.clear(TAB)
  store = new PassStore()
  await store.start()
  await store.setup('correct horse battery staple')
})

afterEach(() => {
  passBubbles.clear(TAB)
})

describe('where Pass fills', () => {
  test('a page that is not https, nor on this machine, is offered nothing', async () => {
    await kept(login({ username: 'alice', password: 'pw' }))
    made()
    await marked(frameAt('http://bank.com/login', { secure: false }), 'login', [
      'username',
      'password',
    ])
    expect(shown()).toBeNull()
    await marked(frameAt('http://bank.com/login', { secure: true }), 'login', ['password'])
    expect(shown()).toBeNull()
  })

  test("a frame whose address is not on the engine's origin is dropped", async () => {
    await kept(login({ username: 'alice', password: 'pw' }))
    made()
    await marked(frameAt('https://bank.com/login', { origin: 'https://evil.com' }), 'login', [
      'username',
      'password',
    ])
    expect(shown()).toBeNull()
    expect(heard.filled).toHaveLength(0)
  })

  test('a frame inside the page is filled only for a login that names its origin', async () => {
    await kept(login({ title: 'Site wide', username: 'alice', password: 'pw' }))
    made()
    const inner = frameAt('https://accounts.bank.com/frame', { frame: 'inner', top: false })
    await marked(inner, 'login', ['username', 'password'])
    const bubble = shown()
    expect(bubble?.kind === 'choose' && bubble.logins).toEqual([])
    const named = await kept(
      login({ title: 'Named', websites: [site('https://accounts.bank.com', 'host')] }),
    )
    await marked(inner, 'login', ['username', 'password'])
    const again = shown()
    expect(again?.kind === 'choose' && again.logins.map((one) => one.id)).toEqual([named.id])
  })

  test('a frame of another site entirely is offered no login', async () => {
    await kept(login({ username: 'alice', password: 'pw' }))
    made()
    await marked(frameAt('https://evil.com/frame', { frame: 'inner', top: false }), 'login', [
      'username',
      'password',
    ])
    const bubble = shown()
    expect(bubble?.kind === 'choose' && bubble.logins).toEqual([])
  })
})

describe('the mark', () => {
  test('choosing a login fills its username and password, and notes the use', async () => {
    const item = await kept(login({ username: 'alice', password: 'pw' }))
    const autofill = made()
    const frame = frameAt('https://bank.com/login')
    await marked(frame, 'login', ['username', 'password'])
    const bubble = shown()
    expect(bubble?.kind).toBe('choose')
    expect(bubble?.kind === 'choose' && bubble.logins).toEqual([
      { id: item.id, title: 'Bank', subtitle: 'alice' },
    ])
    await autofill.choose(TAB, item.id)
    const target: FillTarget = { tab: TAB, frame: 'main', origin: BANK, form: '1' }
    expect(heard.filled).toEqual([{ target, values: { e10: 'alice', e11: 'pw' }, submit: false }])
    expect(shown()).toBeNull()
    expect(store.items.find((one) => one.id === item.id)?.used).not.toBeNull()
  })

  test('a 2FA field gets the code, and the code is copied when asked', async () => {
    const item = await kept(login({ username: 'alice', password: 'pw', totp: TOTP }))
    store.setSetting('copyTotpAfterFill', true)
    const copied = vi.spyOn(store, 'copy').mockResolvedValue()
    const autofill = made()
    await marked(frameAt('https://bank.com/2fa'), 'totp', ['totp'])
    await autofill.choose(TAB, item.id)
    expect(heard.filled[0]?.values).toEqual({ e10: '94287082' })
    expect(copied).toHaveBeenCalledWith('94287082')
  })

  test('a sign-up form offers a generated password into its new password fields', async () => {
    const autofill = made()
    await marked(frameAt('https://bank.com/join'), 'signup', [
      'email',
      'new-password',
      'new-password',
    ])
    const bubble = shown()
    expect(bubble?.kind === 'choose' && bubble.generate).toBe(true)
    await autofill.generate(TAB)
    const values = heard.filled[0]?.values ?? {}
    expect(Object.keys(values)).toEqual(['e11', 'e12'])
    expect(values.e11).toHaveLength(20)
    expect(values.e11).toBe(values.e12)
  })

  test('a sign-up form offers an alias for its email field', async () => {
    const autofill = made()
    await marked(frameAt('https://www.bank.com/join'), 'signup', ['email', 'new-password'])
    const bubble = shown()
    expect(bubble?.kind === 'choose' && bubble.alias).toBe(true)
    await autofill.alias(TAB)
    expect(heard.aliasFor).toEqual(['www.bank.com'])
    expect(heard.filled[0]?.values).toEqual({ e10: 'quiet.fox@alias.example' })
  })

  test("a card's fields are filled by their roles, the expiry whole or in two", async () => {
    const card: Card = {
      ...blank('card'),
      title: 'Visa',
      holder: 'Alice Doe',
      number: '4111 1111 1111 1111',
      expiry: '04/29',
      code: '123',
    }
    const item = await kept(card)
    const autofill = made()
    await marked(frameAt('https://shop.com/pay'), 'card', [
      'cc-name',
      'cc-number',
      'cc-exp',
      'cc-exp-month',
      'cc-exp-year',
      'cc-csc',
    ])
    const bubble = shown()
    expect(bubble?.kind === 'choose' && bubble.cards.map((one) => one.id)).toEqual([item.id])
    expect(bubble?.kind === 'choose' && bubble.fields).toEqual([
      'cc-name',
      'cc-number',
      'cc-exp',
      'cc-exp-month',
      'cc-exp-year',
      'cc-csc',
    ])
    await autofill.choose(TAB, item.id)
    expect(heard.filled[0]?.values).toEqual({
      e10: 'Alice Doe',
      e11: '4111111111111111',
      e12: '04/29',
      e13: '04',
      e14: '2029',
      e15: '123',
    })
  })

  test("an identity's fields are filled by their roles", async () => {
    const identity: Identity = {
      ...blank('identity'),
      title: 'Me',
      values: {
        firstName: 'Alice',
        lastName: 'Doe',
        email: 'alice@doe.com',
        phone: '+41 1',
        street: 'Main 1',
        zip: '8000',
        city: 'Zurich',
        country: 'CH',
        company: 'Doe AG',
      },
    }
    const item = await kept(identity)
    const autofill = made()
    await marked(frameAt('https://shop.com/address'), 'identity', [
      'name',
      'given-name',
      'family-name',
      'email',
      'tel',
      'street-address',
      'postal-code',
      'address-level2',
      'country',
      'organization',
      'bday',
    ])
    await autofill.choose(TAB, item.id)
    expect(heard.filled[0]?.values).toEqual({
      e10: 'Alice Doe',
      e11: 'Alice',
      e12: 'Doe',
      e13: 'alice@doe.com',
      e14: '+41 1',
      e15: 'Main 1',
      e16: '8000',
      e17: 'Zurich',
      e18: 'CH',
      e19: 'Doe AG',
    })
  })

  test('a field Pass cannot see is not filled', async () => {
    const item = await kept(login({ username: 'alice', password: 'pw' }))
    const autofill = made()
    const frame = frameAt('https://bank.com/login')
    const form = formOf('1', 'login', ['username', 'password'])
    const hidden = {
      ...form,
      fields: form.fields.map((one, at) => ({ ...one, visible: at === 1 })),
    }
    await said('forms', { ...frame, forms: [hidden] })
    await said('mark', { ...frame, form: '1', field: 'e11' })
    await autofill.choose(TAB, item.id)
    expect(heard.filled[0]?.values).toEqual({ e11: 'pw' })
  })

  test('with Pass locked the bubble only offers to unlock it', async () => {
    await kept(login({ username: 'alice', password: 'pw' }))
    store.setSetting('autoLogin', true)
    store.lock()
    made()
    const frame = frameAt('https://bank.com/login')
    await marked(frame, 'login', ['username', 'password'])
    expect(shown()).toEqual({ kind: 'unlock', tab: TAB })
    await said('submitted', submitted(frame, { username: 'bob', password: 'new' }))
    expect(shown()).toEqual({ kind: 'unlock', tab: TAB })
    expect(heard.filled).toHaveLength(0)
  })

  test('a site with autofill turned off is offered nothing', async () => {
    await kept(login({ username: 'alice', password: 'pw' }))
    store.setSetting('paused', {
      'bank.com': {
        autofill: true,
        totp: false,
        suggest: false,
        save: false,
        passkeys: false,
        autoLogin: false,
      },
    })
    made()
    await marked(frameAt('https://bank.com/login'), 'login', ['username', 'password'])
    expect(shown()).toBeNull()
  })
})

describe('saving what was sent', () => {
  test('a login Pass does not have asks to be saved, and is saved for the site', async () => {
    const autofill = made()
    const frame = frameAt('https://www.bank.com/login')
    await said('submitted', submitted(frame, { username: 'alice@bank.com', password: 'pw' }))
    expect(shown()).toEqual({
      kind: 'save',
      tab: TAB,
      site: 'bank.com',
      username: 'alice@bank.com',
      update: false,
    })
    await autofill.save(TAB)
    const saved = store.items.find((one) => one.content.kind === 'login')
    expect(saved?.vault).toBe(store.vaults[0]?.id)
    expect(saved?.content).toMatchObject({
      title: 'bank.com',
      email: 'alice@bank.com',
      password: 'pw',
      websites: [{ url: 'https://www.bank.com/', match: 'domain' }],
    })
    expect(store.matching('https://bank.com/again').map((one) => one.id)).toEqual([saved?.id])
  })

  test('the same password again says nothing; another one asks to update it', async () => {
    const item = await kept(login({ email: 'alice@bank.com', password: 'pw' }))
    const autofill = made()
    const frame = frameAt('https://bank.com/login')
    await said('submitted', submitted(frame, { username: 'Alice@bank.com', password: 'pw' }))
    expect(shown()).toBeNull()
    await said('submitted', submitted(frame, { username: 'alice@bank.com', password: 'pw2' }))
    expect(shown()).toMatchObject({ kind: 'save', update: true })
    await autofill.save(TAB)
    const content = store.items.find((one) => one.id === item.id)?.content
    expect(content?.kind === 'login' && content.password).toBe('pw2')
    expect(store.items).toHaveLength(1)
  })

  test('a password page after a username page is matched by the username sent first', async () => {
    await kept(login({ username: 'alice', password: 'pw' }))
    await kept(login({ username: 'bob', password: 'other' }))
    made()
    const frame = frameAt('https://bank.com/login')
    await said('submitted', submitted(frame, { kind: 'username', username: 'alice' }))
    await said('submitted', submitted(frame, { kind: 'password', password: 'pw' }))
    expect(shown()).toBeNull()
    await said('submitted', submitted(frame, { kind: 'password', password: 'changed' }))
    expect(shown()).toMatchObject({ kind: 'save', username: 'alice', update: true })
  })

  test('a password with no name sent beside it is never taken for a new password', async () => {
    await kept(login({ username: 'alice', password: 'pw' }))
    made()
    const frame = frameAt('https://bank.com/unlock')
    await said('submitted', submitted(frame, { kind: 'password', password: 'something else' }))
    expect(shown()).toMatchObject({ kind: 'save', username: null, update: false })
  })

  test('a change of password with the old one Pass holds asks to update it', async () => {
    const item = await kept(login({ username: 'alice', password: 'pw' }))
    const autofill = made()
    const frame = frameAt('https://bank.com/settings')
    await said(
      'submitted',
      submitted(frame, { kind: 'change', password: 'pw', newPassword: 'new-pw' }),
    )
    expect(shown()).toMatchObject({ kind: 'save', update: true })
    await autofill.save(TAB)
    const content = store.items.find((one) => one.id === item.id)?.content
    expect(content?.kind === 'login' && content.password).toBe('new-pw')
  })

  test("a sign-up's new password is what is saved", async () => {
    const autofill = made()
    const frame = frameAt('https://bank.com/join')
    await said(
      'submitted',
      submitted(frame, { kind: 'signup', username: 'carol', newPassword: 'fresh' }),
    )
    await autofill.save(TAB)
    const content = store.items[0]?.content
    expect(content?.kind === 'login' && content.password).toBe('fresh')
  })

  test('Never for this site turns saving off there and nothing more is asked', async () => {
    const autofill = made()
    const frame = frameAt('https://bank.com/login')
    await said('submitted', submitted(frame, { username: 'alice', password: 'pw' }))
    autofill.never(TAB)
    expect(store.settings.paused['bank.com']).toMatchObject({ save: true, autofill: false })
    await said('submitted', submitted(frame, { username: 'alice', password: 'pw' }))
    expect(shown()).toBeNull()
    expect(store.items).toHaveLength(0)
  })

  test('with saving turned off nothing is asked', async () => {
    store.setSetting('autosave', false)
    made()
    await said('submitted', submitted(frameAt(`${BANK}/login`), { username: 'a', password: 'b' }))
    expect(shown()).toBeNull()
  })
})

describe('signing in by itself', () => {
  beforeEach(() => {
    store.setSetting('autoLogin', true)
  })

  test('a sign-in page with one login is filled and sent', async () => {
    await kept(login({ username: 'alice', password: 'pw' }))
    made()
    await said('forms', forms(frameAt(`${BANK}/login`), 'login', ['username', 'password']))
    await settled(1)
    expect(heard.filled[0]).toMatchObject({ values: { e10: 'alice', e11: 'pw' }, submit: true })
  })

  test('the bubble says who is signing in, before the step is taken', async () => {
    await kept(login({ username: 'alice', password: 'pw' }))
    made(80)
    await said('forms', forms(frameAt(`${BANK}/login`), 'login', ['username', 'password']))
    expect(shown()).toEqual({ kind: 'signing', tab: TAB, name: 'alice' })
    expect(heard.filled).toHaveLength(0)
    await settled(1)
  })

  test('the username page, then the password page', async () => {
    await kept(login({ username: 'alice', password: 'pw' }))
    made()
    await said('forms', forms(frameAt(`${BANK}/signin`), 'username', ['username']))
    await settled(1)
    await said('forms', forms(frameAt(`${BANK}/signin/password`), 'password', ['password']))
    await settled(2)
    expect(heard.filled.map((one) => one.values)).toEqual([{ e10: 'alice' }, { e10: 'pw' }])
    expect(heard.filled.every((one) => one.submit)).toBe(true)
  })

  test('the username, the password and then the 2FA code', async () => {
    await kept(login({ username: 'alice', password: 'pw', totp: TOTP }))
    made()
    await said('forms', forms(frameAt(`${BANK}/a`), 'username', ['username']))
    await settled(1)
    await said('forms', forms(frameAt(`${BANK}/b`), 'password', ['password']))
    await settled(2)
    await said('forms', forms(frameAt(`${BANK}/c`), 'totp', ['totp']))
    await settled(3)
    expect(heard.filled[2]?.values).toEqual({ e10: '94287082' })
  })

  test('the same page again, as after a wrong password, is not sent twice', async () => {
    await kept(login({ username: 'alice', password: 'wrong' }))
    made()
    const page = forms(frameAt(`${BANK}/login`), 'login', ['username', 'password'])
    await said('forms', page)
    await settled(1)
    await said('forms', forms(frameAt(`${BANK}/login?error=1`), 'login', ['username', 'password']))
    await said('forms', page)
    await new Promise((done) => setTimeout(done, 50))
    expect(heard.filled).toHaveLength(1)
    expect(shown()).toBeNull()
  })

  test('two matching logins sign in neither and offer the choice', async () => {
    await kept(login({ username: 'alice', password: 'pw' }))
    await kept(login({ username: 'bob', password: 'pw2' }))
    made()
    await said('forms', forms(frameAt(`${BANK}/login`), 'login', ['username', 'password']))
    await new Promise((done) => setTimeout(done, 50))
    expect(heard.filled).toHaveLength(0)
    const bubble = shown()
    expect(bubble?.kind === 'choose' && bubble.logins).toHaveLength(2)
  })

  test('a login for the whole site only offers itself on a subdomain, never sends', async () => {
    await kept(login({ username: 'alice', password: 'pw' }))
    made()
    await said(
      'forms',
      forms(frameAt('https://accounts.bank.com/login'), 'login', ['username', 'password']),
    )
    await new Promise((done) => setTimeout(done, 50))
    expect(heard.filled).toHaveLength(0)
    const bubble = shown()
    expect(bubble?.kind === 'choose' && bubble.logins).toHaveLength(1)
  })

  test('a login naming the subdomain itself signs in there', async () => {
    await kept(
      login({ username: 'alice', password: 'pw', websites: [site('https://accounts.bank.com')] }),
    )
    made()
    await said(
      'forms',
      forms(frameAt('https://accounts.bank.com/login'), 'login', ['username', 'password']),
    )
    await settled(1)
  })

  test('no matching login does nothing', async () => {
    made()
    await said('forms', forms(frameAt(`${BANK}/login`), 'login', ['username', 'password']))
    expect(shown()).toBeNull()
    expect(heard.filled).toHaveLength(0)
  })

  test('Stop stops the step about to be taken and the ones after it', async () => {
    await kept(login({ username: 'alice', password: 'pw' }))
    const autofill = made(60)
    await said('forms', forms(frameAt(`${BANK}/a`), 'username', ['username']))
    autofill.dismiss(TAB)
    await new Promise((done) => setTimeout(done, 120))
    expect(heard.filled).toHaveLength(0)
    expect(shown()).toBeNull()
    await said('forms', forms(frameAt(`${BANK}/b`), 'password', ['password']))
    await new Promise((done) => setTimeout(done, 120))
    expect(heard.filled).toHaveLength(0)
  })

  test('a step later than two minutes into the sign-in is not taken', async () => {
    await kept(login({ username: 'alice', password: 'pw' }))
    made()
    await said('forms', forms(frameAt(`${BANK}/a`), 'username', ['username']))
    await settled(1)
    clock += FLOW_WINDOW + 1000
    await said('forms', forms(frameAt(`${BANK}/b`), 'password', ['password']))
    await new Promise((done) => setTimeout(done, 50))
    expect(heard.filled).toHaveLength(1)
  })

  test('a 2FA page on its own is not a sign-in to start', async () => {
    await kept(login({ username: 'alice', password: 'pw', totp: TOTP }))
    made()
    await said('forms', forms(frameAt(`${BANK}/2fa`), 'totp', ['totp']))
    await new Promise((done) => setTimeout(done, 50))
    expect(heard.filled).toHaveLength(0)
  })

  test('a site left out of signing in by itself is not signed in', async () => {
    await kept(login({ username: 'alice', password: 'pw' }))
    store.setSetting('paused', {
      'bank.com': {
        autofill: false,
        totp: false,
        suggest: false,
        save: false,
        passkeys: false,
        autoLogin: true,
      },
    })
    made()
    await said('forms', forms(frameAt(`${BANK}/login`), 'login', ['username', 'password']))
    await new Promise((done) => setTimeout(done, 50))
    expect(heard.filled).toHaveLength(0)
  })

  test('with signing in by itself off, nothing is sent', async () => {
    store.setSetting('autoLogin', false)
    await kept(login({ username: 'alice', password: 'pw' }))
    made()
    await said('forms', forms(frameAt(`${BANK}/login`), 'login', ['username', 'password']))
    await new Promise((done) => setTimeout(done, 50))
    expect(heard.filled).toHaveLength(0)
  })

  test('with Pass locked nothing is sent', async () => {
    await kept(login({ username: 'alice', password: 'pw' }))
    store.lock()
    made()
    await said('forms', forms(frameAt(`${BANK}/login`), 'login', ['username', 'password']))
    await new Promise((done) => setTimeout(done, 50))
    expect(heard.filled).toHaveLength(0)
    expect(shown()).toBeNull()
  })

  test('an insecure page is never signed in', async () => {
    await kept(login({ username: 'alice', password: 'pw', websites: [site('http://bank.com')] }))
    made()
    await said(
      'forms',
      forms(frameAt('http://bank.com/login', { secure: false }), 'login', ['username', 'password']),
    )
    await new Promise((done) => setTimeout(done, 50))
    expect(heard.filled).toHaveLength(0)
  })
})

describe('with the password manager turned off in Settings', () => {
  beforeEach(() => {
    store.setSetting('autoLogin', true)
  })

  test('a page shows no mark, asks to save nothing and signs nobody in', async () => {
    await kept(login({ username: 'alice', password: 'pw' }))
    made()
    hiddenKinds.hidden = []
    await marked(frameAt(`${BANK}/login`), 'login', ['username', 'password'])
    await said('submitted', submitted(frameAt(`${BANK}/login`), { username: 'bob', password: 'x' }))
    await new Promise((done) => setTimeout(done, 50))
    expect(shown()).toBeNull()
    expect(heard.filled).toHaveLength(0)
  })

  test('a sign-in already under way when it is turned off is not taken', async () => {
    await kept(login({ username: 'alice', password: 'pw' }))
    const autofill = made(80)
    await said('forms', forms(frameAt(`${BANK}/login`), 'login', ['username', 'password']))
    expect(shown()?.kind).toBe('signing')
    hiddenKinds.hidden = []
    autofill.quiet()
    await new Promise((done) => setTimeout(done, 150))
    expect(shown()).toBeNull()
    expect(heard.filled).toHaveLength(0)
  })

  test('turned on again, the logins it kept fill as before', async () => {
    const item = await kept(login({ username: 'alice', password: 'pw' }))
    const autofill = made()
    hiddenKinds.hidden = []
    store.lock()
    hiddenKinds.hidden = [PASS_WORD]
    expect(await store.unlock({ password: 'correct horse battery staple' })).toBe(true)
    store.setSetting('autoLogin', false)
    await marked(frameAt(`${BANK}/login`), 'login', ['username', 'password'])
    const bubble = shown()
    expect(bubble?.kind === 'choose' && bubble.logins.map((one) => one.id)).toEqual([item.id])
    await autofill.choose(TAB, item.id)
    expect(heard.filled[0]).toMatchObject({ values: { e10: 'alice', e11: 'pw' } })
  })
})
