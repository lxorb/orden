import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import DeleteAccount from '../../src/lib/accounts-ui/src/DeleteAccount.svelte'
import { account } from '../../src/lib/accounts/src/account.svelte'
import { warmCalls } from '../../src/lib/accounts/src/client'
import type { RemoteSpace } from '../../src/lib/accounts/src/routes'
import Leaving from '../../src/lib/accounts-ui/src/Leaving.svelte'
import { leavingDay, leavingNow, markLeaving } from '../../src/lib/accounts-ui/src/leaving'
import { idle, settle } from './settle'

await warmCalls()
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation
const DAY = Date.now() + 30 * 24 * 60 * 60 * 1000
interface Asked {
  route: string
  body: Record<string, unknown> | null
  token: string | null
}
type Answer = (body: Record<string, unknown> | null) => [number, unknown]
let host: HTMLElement
let shown: ReturnType<typeof mount> | null = null
let asked: Asked[]
let ended: number
function serve(routes: Record<string, Answer>) {
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    const route = `${init.method ?? 'GET'} ${new URL(url).pathname}`
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
    const token = (init.headers as Record<string, string> | undefined)?.authorization ?? null
    asked.push({ route, body, token })
    const [status, json] = routes[route]?.(body) ?? [404, { error: 'no such route' }]
    return Promise.resolve(new Response(JSON.stringify(json), { status }))
  })
}
const SIGNED_OUT: Record<string, Answer> = {
  'POST /v1/auth/signout': () => [200, { ok: true }],
}
function open() {
  shown = mount(DeleteAccount, { target: host, props: { onend: () => (ended += 1) } })
  flushSync()
}
function type(label: string, value: string) {
  const field = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  if (!field) throw new Error(`no field ${label}`)
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}
function submit() {
  host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}
function press(words: string) {
  const button = [...host.querySelectorAll('button')].find((one) => one.textContent.trim() === words)
  if (!button) throw new Error(`no button ${words}`)
  button.click()
}
beforeEach(() => {
  asked = []
  ended = 0
  account.token = 'session'
  account.user = { id: 'me', email: 'me@example.com', name: null }
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => {
  if (shown) void unmount(shown)
  shown = null
  host.remove()
  account.token = null
  account.user = null
  account.staying = false
  localStorage.removeItem('orden:leaving')
  account.open = false
  account.error = null
  vi.unstubAllGlobals()
})
test('pressing it mails a code; a wrong one is said, and nothing is deleted', async () => {
  serve({
    'POST /v1/account/delete/code': () => [200, { resendIn: 30, second: false }],
    'POST /v1/account/delete/verify': () => [400, { error: 'that code is not right' }],
  })
  open()
  await settle()
  expect(asked).toEqual([{ route: 'POST /v1/account/delete/code', body: {}, token: 'Bearer session' }])
  expect(host.textContent).toContain('me@example.com')
  expect(host.textContent).not.toContain('Notes on this device stay')
  expect(host.querySelector('input[aria-label="App code to delete"]')).toBeNull()
  type('Code', '111111')
  submit()
  await settle()
  expect(host.textContent).toContain('that code is not right')
  expect(asked.map((one) => one.route)).not.toContain('DELETE /v1/account')
  expect(host.textContent).not.toContain('Delete in 30 days')
  expect(account.user?.id).toBe('me')
})
test('the codes, the second one, the last question, and then signed out and quiet', async () => {
  serve({
    'POST /v1/account/delete/code': () => [200, { resendIn: 30, second: true, keptDays: 30 }],
    'POST /v1/account/delete/verify': (body) =>
      body?.code === '123456' && body.second === '654321'
        ? [200, { ticket: 'earned' }]
        : [400, { error: 'that code is not right' }],
    'DELETE /v1/account': (body) =>
      body?.ticket === 'earned' ? [200, { ok: true, deleteAfter: DAY }] : [400, { error: 'start again' }],
    ...SIGNED_OUT,
  })
  open()
  await settle()
  type('Code', '123456')
  type('App code to delete', '654321')
  submit()
  await settle()
  expect(asked[1]).toEqual({
    route: 'POST /v1/account/delete/verify',
    body: { code: '123456', second: '654321' },
    token: 'Bearer session',
  })
  expect(asked.map((one) => one.route)).not.toContain('DELETE /v1/account')
  expect(host.textContent).toContain('Your account is deleted in 30 days')
  expect(host.textContent).toContain('Signing in before then cancels the deletion')
  expect(leavingNow()).toBeNull()
  press('Delete in 30 days')
  await settle()
  expect(asked.map((one) => one.route)).toEqual([
    'POST /v1/account/delete/code',
    'POST /v1/account/delete/verify',
    'DELETE /v1/account',
    'POST /v1/auth/signout',
  ])
  expect(asked[2]?.body).toEqual({ ticket: 'earned' })
  expect(account.user).toBeNull()
  expect(account.token).toBeNull()
  expect(account.syncable).toBe(false)
  expect(ended).toBe(1)
  expect(leavingNow()).toEqual({ email: 'me@example.com', on: DAY })
  const before = asked.length
  await idle(50)
  expect(asked.length).toBe(before)
})
test('the last question names the spaces other people lose, and only those', async () => {
  const space = (name: string, role: string, shared: boolean) =>
    ({ id: name, name, role, shared }) as unknown as RemoteSpace
  account.spaces = [space('Plans', 'owner', true), space('Diary', 'owner', false), space('Theirs', 'write', true)]
  serve({
    'POST /v1/account/delete/code': () => [200, { resendIn: 30, second: false, keptDays: 30 }],
    'POST /v1/account/delete/verify': () => [200, { ticket: 'earned' }],
  })
  open()
  await settle()
  expect(host.textContent).not.toContain('lso gone')
  type('Code', '123456')
  submit()
  await settle()
  expect(host.textContent).toContain('Then also gone for everyone in')
  expect(host.textContent).toContain('Plans')
  expect(host.textContent).not.toContain('Diary')
  expect(host.textContent).not.toContain('Theirs')
  account.spaces = []
})
async function deleteNow() {
  open()
  await settle()
  type('Code', '123456')
  submit()
  await settle()
  press('Delete in 30 days')
  await settle()
  await settle()
}
const SESSION_GONE: Record<string, Answer> = {
  'POST /v1/account/delete/code': () => [200, { resendIn: 30, second: false, keptDays: 30 }],
  'POST /v1/account/delete/verify': () => [200, { ticket: 'earned' }],
  'DELETE /v1/account': () => [401, { error: 'sign in first' }],
  'GET /v1/me': () => [401, { error: 'sign in first' }],
  ...SIGNED_OUT,
}
test('an answer lost on the way back from a delete that happened still signs out', async () => {
  serve({
    ...SESSION_GONE,
    'POST /v1/account/left': (body) => [200, { gone: body?.ticket === 'earned', deleteAfter: DAY }],
  })
  await deleteNow()
  expect(leavingNow()).toEqual({ email: 'me@example.com', on: DAY })
  expect(asked.find((one) => one.route === 'POST /v1/account/left')).toEqual({
    route: 'POST /v1/account/left',
    body: { ticket: 'earned' },
    token: null,
  })
  expect(account.user).toBeNull()
  expect(account.open).toBe(false)
  expect(account.error).toBeNull()
  expect(ended).toBe(1)
})
test('a session ended elsewhere is not taken for a deleted account', async () => {
  serve({ ...SESSION_GONE, 'POST /v1/account/left': () => [200, { gone: false }] })
  await deleteNow()
  expect(account.user).toBeNull()
  expect(account.open).toBe(true)
  expect(account.error).toBe('Signed out elsewhere; the account was not deleted. Sign in again to delete it.')
  expect(leavingNow()).toBeNull()
  expect(ended).toBe(1)
})
test('a server that cannot say whether it went is not taken for a deleted account either', async () => {
  serve(SESSION_GONE)
  await deleteNow()
  expect(account.user).toBeNull()
  expect(account.open).toBe(true)
  expect(account.error).toBe('Signed out; sign in again to see whether the account is still there.')
  expect(ended).toBe(1)
})
test('Cancel ends it with nothing deleted', async () => {
  serve({ 'POST /v1/account/delete/code': () => [200, { resendIn: 30, second: false }] })
  open()
  await settle()
  press('Cancel')
  await settle()
  expect(ended).toBe(1)
  expect(asked.map((one) => one.route)).toEqual(['POST /v1/account/delete/code'])
  expect(account.user?.id).toBe('me')
})
function note(): string {
  shown = mount(Leaving, { target: host })
  flushSync()
  return host.textContent.replace(/\s+/g, ' ').trim()
}
test('signed out, the account page names the account and the day it goes', () => {
  account.token = null
  account.user = null
  markLeaving('me@example.com', DAY)
  const words = note()
  expect(words).toContain('me@example.com')
  expect(words).toContain(`will be deleted on ${leavingDay(DAY)}`)
  expect(words).toContain('Signing in before then, on any device, cancels the deletion.')
})
test('and says nothing while signed in, once the sign-in cancelled it, or with nothing asked', () => {
  expect(note()).toBe('')
  markLeaving('me@example.com', DAY)
  flushSync()
  expect(host.textContent.trim()).toBe('')
  account.token = null
  account.user = null
  account.staying = true
  flushSync()
  expect(host.textContent.trim()).toBe('')
})
test('a day that has passed is forgotten, and a server that names no day leaves nothing', () => {
  account.token = null
  account.user = null
  markLeaving('me@example.com', undefined)
  expect(leavingNow()).toBeNull()
  markLeaving('me@example.com', DAY)
  expect(leavingNow(DAY + 1)).toBeNull()
  expect(localStorage.getItem('orden:leaving')).toBeNull()
  expect(note()).toBe('')
})
test('a server that still deletes at once is not said to wait thirty days', async () => {
  const space = (name: string) => ({ id: name, name, role: 'owner', shared: true }) as unknown as RemoteSpace
  account.spaces = [space('Plans')]
  serve({
    'POST /v1/account/delete/code': () => [200, { resendIn: 30, second: false }],
    'POST /v1/account/delete/verify': () => [200, { ticket: 'earned' }],
    'DELETE /v1/account': () => [200, { ok: true }],
    ...SIGNED_OUT,
  })
  open()
  await settle()
  type('Code', '123456')
  submit()
  await settle()
  expect(host.textContent).not.toContain('30 days')
  expect(host.textContent).not.toContain('cancels the deletion')
  expect(host.textContent).toContain('Also gone for everyone in')
  press('Delete now')
  await settle()
  expect(account.user).toBeNull()
  expect(leavingNow()).toBeNull()
  account.spaces = []
})
