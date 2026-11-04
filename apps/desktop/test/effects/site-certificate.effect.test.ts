/** A web tab's site popover, mounted: pressing "Connection is secure" shows the chain
 *  the page came with (#776).
 *
 *  What it was. The certificate hid behind a separate Certificate button, and showed
 *  one certificate - the site's - with nothing of who it was trusted through. Pressing
 *  the line that says the connection is secure, which is where a browser keeps it, did
 *  nothing, and on Windows and a Mac the crate answered nothing at all. Now every
 *  engine answers the chain (web_certificate.rs), and the line itself opens it: the
 *  site's certificate, each intermediate and the root, each with whom it was issued to
 *  and by, organisations included. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** What the crate answers, and what it was asked. */
interface Answers {
  certificate: unknown
  asked: unknown[]
}
const answers = vi.hoisted((): Answers => ({ certificate: null, asked: [] }))

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  invoke: (command: string, args: unknown) => {
    if (command !== 'web_certificate') return Promise.resolve(undefined)
    answers.asked.push(args)
    return Promise.resolve(answers.certificate)
  },
}))

const WebSite = (await import('../../src/lib/web-tab/WebSite.svelte')).default

const party = (name: string, ...organization: string[]) => ({ name, organization })
const link = (to: ReturnType<typeof party>, by: ReturnType<typeof party>, root = false) => ({
  to,
  by,
  from: Date.UTC(2026, 0, 1),
  until: Date.UTC(2027, 0, 1),
  serial: '01:02',
  sha256: `${to.name}-fingerprint`,
  root,
})

const SITE = party('example.com')
const INTERMEDIATE = party('R3', "Let's Encrypt")
const ROOT = party('ISRG Root X1', 'Internet Security Research Group')

const CHAIN = {
  secure: true,
  separately: false,
  chain: [link(SITE, INTERMEDIATE), link(INTERMEDIATE, ROOT), link(ROOT, ROOT, true)],
}

let target: HTMLElement
let app: ReturnType<typeof mount> | undefined

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  answers.asked = []
})

afterEach(() => {
  if (app) void unmount(app)
  app = undefined
  target.remove()
})

async function opened(url: string, certificate: unknown) {
  answers.certificate = certificate
  app = mount(WebSite, {
    target,
    props: { url, site: new URL(url).host, tab: 'tab-1', onclose: () => undefined },
  })
  flushSync()
  // The crate's answer, which the popover asked for as it opened.
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  flushSync()
}

const text = (selector: string) => target.querySelector(selector)?.textContent ?? ''

test('pressing the secure connection line shows the whole chain, site first, up to the root', async () => {
  await opened('https://example.com/a', CHAIN)
  expect(answers.asked).toEqual([{ tab: 'tab-1', address: 'https://example.com/a' }])

  const line = target.querySelector<HTMLButtonElement>('button.how')
  expect(line?.textContent).toContain('Connection is secure')
  expect(line?.getAttribute('aria-expanded')).toBe('false')
  expect(target.querySelector('.chain')).toBeNull()

  line?.click()
  flushSync()
  expect(line?.getAttribute('aria-expanded')).toBe('true')

  const steps = [...target.querySelectorAll<HTMLButtonElement>('.chain button')]
  expect(steps.map((one) => one.dataset.role)).toEqual(['site', 'intermediate', 'root'])
  expect(steps.map((one) => one.querySelector('.name')?.textContent)).toEqual([
    'example.com',
    "R3 · Let's Encrypt",
    'ISRG Root X1 · Internet Security Research Group',
  ])

  // The site's certificate first, its issuer with the issuer's organisation.
  expect(text('.details')).toContain('example.com')
  expect(text('.details')).toContain("R3 · Let's Encrypt")
  expect(text('.details')).toContain('example.com-fingerprint')
  expect(text('.details')).toContain('01:02')

  // Another of the chain, chosen.
  steps[2]?.click()
  flushSync()
  expect(steps[2]?.getAttribute('aria-pressed')).toBe('true')
  expect(steps[0]?.getAttribute('aria-pressed')).toBe('false')
  expect(text('.details')).toContain('ISRG Root X1-fingerprint')
  expect(text('.details')).toContain('Internet Security Research Group')

  // And pressed again, closed.
  line?.click()
  flushSync()
  expect(target.querySelector('.chain')).toBeNull()
})

test('a chain read from the site separately says so', async () => {
  await opened('https://example.com/', {
    ...CHAIN,
    separately: true,
    chain: CHAIN.chain.slice(0, 2),
  })
  target.querySelector<HTMLButtonElement>('button.how')?.click()
  flushSync()
  expect(text('.certificate .note')).toContain('Read from the site separately')
  expect(
    [...target.querySelectorAll<HTMLElement>('.chain button')].map((one) => one.dataset.role),
  ).toEqual(['site', 'intermediate'])
})

test('an engine that found the certificate wrong is not called secure', async () => {
  await opened('https://example.com/', { ...CHAIN, secure: false })
  expect(text('button.how')).toContain('Connection is not secure')
  expect(target.querySelector('button.how.risky')).not.toBeNull()
})

test('an https page whose certificate could not be read says that when pressed', async () => {
  await opened('https://example.com/', null)
  target.querySelector<HTMLButtonElement>('button.how')?.click()
  flushSync()
  expect(text('.certificate')).toContain('The certificate could not be read.')
})

test('a plain http page has no certificate to press for, and none is asked for', async () => {
  await opened('http://example.com/', CHAIN)
  expect(answers.asked).toEqual([])
  expect(target.querySelector('button.how')).toBeNull()
  expect(text('p.how')).toContain('Connection is not secure')
})
