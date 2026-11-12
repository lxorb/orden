import { dayOf } from '@orden/sync-core'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { call, type TestEnv, testEnv } from './harness'

let env: TestEnv
let forwarded: { url: string; body: { api_key: string; batch: Record<string, unknown>[] } }[]
let answering: () => Response

beforeEach(() => {
  forwarded = []
  answering = () => new Response('{"status":1}', { status: 200 })
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString()
    forwarded.push({
      url,
      body: JSON.parse(init?.body as string) as (typeof forwarded)[number]['body'],
    })
    return answering()
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  env.close()
})

const today = () => dayOf(Date.now())

function daily(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    kind: 'daily',
    day: today(),
    app: { version: '0.21.1', channel: 'stable' },
    system: { os: 'macos', osVersion: '15.1', arch: 'aarch64', form: 'desktop', engine: 'webkit' },
    language: 'de-CH',
    screen: 'large',
    signedIn: false,
    ...overrides,
  }
}

function usageDay(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...daily(),
    kind: 'usage',
    install: 'ab'.repeat(16),
    commands: { 'palette.export': { palette: 2, shortcut: 1 } },
    features: { search: 4 },
    tabs: { note: 30, canvas: 5 },
    settings: { 'general.crashReports': { off: 1 } },
    onboarding: { theme: 1 },
    startup: { 'under-1s': 3 },
    sizes: { notes: '10-99', spaces: '1-9', tabs: '1-9' },
    ...overrides,
  }
}

async function send(body: unknown, headers: Record<string, string> = {}) {
  return call<{ ok?: boolean; taken?: number; error?: string }>(env, '/v1/usage', {
    body,
    headers,
  })
}

describe('the usage door', () => {
  beforeEach(() => {
    env = testEnv({ POSTHOG_KEY: 'phc_test' })
  })

  test('passes a daily ping and a usage day on to PostHog EU without the sender', async () => {
    const answer = await send(
      { events: [daily(), usageDay()] },
      { 'cf-connecting-ip': '203.0.113.7', 'user-agent': 'Orden/0.21.1 (Macintosh)' },
    )

    expect(answer.status).toBe(200)
    expect(answer.json.taken).toBe(2)
    expect(forwarded).toHaveLength(1)
    const [sent] = forwarded
    expect(sent?.url).toBe('https://eu.i.posthog.com/batch/')
    expect(sent?.body.api_key).toBe('phc_test')

    const text = JSON.stringify(sent?.body.batch)
    expect(text).not.toContain('203.0.113.7')
    expect(text).not.toContain('Macintosh')

    const names = sent?.body.batch.map((one) => one.event)
    expect(names).toEqual(
      expect.arrayContaining([
        'daily install',
        'active day',
        'command',
        'feature',
        'tab',
        'setting changed',
        'onboarding step',
        'startup',
      ]),
    )
    for (const one of sent?.body.batch ?? []) {
      const properties = one.properties as Record<string, unknown>
      expect(properties.$process_person_profile).toBe(false)
      expect(properties.$geoip_disable).toBe(true)
      expect(properties.$ip).toBeUndefined()
    }

    const command = sent?.body.batch.find(
      (one) => one.event === 'command' && (one.properties as { via: string }).via === 'palette',
    )
    expect(command?.distinct_id).toBe('ab'.repeat(16))
    expect(command?.properties).toMatchObject({ command: 'palette.export', count: 2 })

    const ping = sent?.body.batch.find((one) => one.event === 'daily install')
    expect(ping?.distinct_id).not.toBe('ab'.repeat(16))
  })

  test('two daily pings never share an id', async () => {
    await send({ events: [daily(), daily()] })
    const ids = forwarded[0]?.body.batch.map((one) => one.distinct_id)
    expect(new Set(ids).size).toBe(2)
  })

  test('the same usage day sent twice keeps the same event ids', async () => {
    await send({ events: [usageDay()] })
    await send({ events: [usageDay()] })
    const first = forwarded[0]?.body.batch.map((one) => one.uuid)
    const second = forwarded[1]?.body.batch.map((one) => one.uuid)
    expect(first).toEqual(second)
  })

  test('days older than thirty are dropped and not passed on', async () => {
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10)
    const answer = await send({ events: [daily({ day: old })] })
    expect(answer.status).toBe(200)
    expect(answer.json.taken).toBe(0)
    expect(forwarded).toHaveLength(0)
  })

  test('an earlier day arrives stamped on that day', async () => {
    const earlier = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10)
    await send({ events: [usageDay({ day: earlier })] })
    expect(forwarded[0]?.body.batch[0]?.timestamp).toBe(`${earlier}T12:00:00.000Z`)
  })

  test('PostHog failing asks the app to keep the batch', async () => {
    answering = () => new Response('no', { status: 500 })
    const answer = await send({ events: [daily()] })
    expect(answer.status).toBe(503)
  })

  test('one machine is held back after many batches in an hour', async () => {
    const headers = { 'cf-connecting-ip': '198.51.100.4' }
    for (let at = 0; at < 60; at++) {
      expect((await send({ events: [daily()] }, headers)).status).toBe(200)
    }
    expect((await send({ events: [daily()] }, headers)).status).toBe(429)
    expect((await send({ events: [daily()] }, { 'cf-connecting-ip': '198.51.100.5' })).status).toBe(
      200,
    )
  })

  test('needs no account', async () => {
    expect((await send({ events: [daily({ signedIn: true })] })).status).toBe(200)
  })
})

describe('the allowlist', () => {
  beforeEach(() => {
    env = testEnv({ POSTHOG_KEY: 'phc_test' })
  })

  const refused: [string, unknown][] = [
    ['a field on the batch', { events: [], extra: 1 }],
    ['a field on a daily ping', { events: [daily({ email: 'a@b.c' })] }],
    ['a field on a usage day', { events: [usageDay({ search: 'secret words' })] }],
    ['errors in a usage day', { events: [usageDay({ errors: { js: 1 } })] }],
    [
      'a field on app',
      { events: [daily({ app: { version: '0.21.1', channel: 'stable', build: 'x' } })] },
    ],
    [
      'a field on system',
      {
        events: [
          daily({
            system: { os: 'linux', arch: 'x86_64', form: 'desktop', engine: 'webkit', host: 'pc' },
          }),
        ],
      },
    ],
    [
      'a field on sizes',
      { events: [usageDay({ sizes: { notes: '0', spaces: '0', tabs: '0', words: '0' } })] },
    ],
    ['a way a command is not run', { events: [usageDay({ commands: { print: { voice: 1 } } })] }],
    ['a startup bucket that is not one', { events: [usageDay({ startup: { '9s': 1 } })] }],
    [
      'a path as a command',
      { events: [usageDay({ commands: { '/home/me/notes.md': { menu: 1 } } })] },
    ],
    ['a url as a tab kind', { events: [usageDay({ tabs: { 'https://example.com': 3 } })] }],
    [
      'text as a setting value',
      { events: [usageDay({ settings: { 'general.dns': { 'My Words': 1 } } })] },
    ],
    ['an email as a feature', { events: [usageDay({ features: { 'me@example.com': 1 } })] }],
    ['a stable install id on a daily ping', { events: [daily({ install: 'ab'.repeat(16) })] }],
    [
      'a made-up os',
      { events: [daily({ system: { os: 'beos', arch: 'x86', form: 'web', engine: 'other' } })] },
    ],
    [
      'a long os version',
      {
        events: [
          daily({
            system: {
              os: 'windows',
              osVersion: '10.0.26100.1742',
              arch: 'x86_64',
              form: 'desktop',
              engine: 'webview2',
            },
          }),
        ],
      },
    ],
    ['an install id that is not random hex', { events: [usageDay({ install: 'me@example.com' })] }],
    ['a count that is not whole', { events: [usageDay({ onboarding: { theme: 1.5 } })] }],
    ['too many events', { events: Array.from({ length: 65 }, () => daily()) }],
  ]

  test.each(refused)('refuses %s', async (_, body) => {
    const answer = await send(body)
    expect(answer.status).toBe(400)
    expect(forwarded).toHaveLength(0)
  })
})

describe('without a PostHog key', () => {
  beforeEach(() => {
    env = testEnv()
  })

  test('takes the batch and passes nothing on', async () => {
    const answer = await send({ events: [daily(), usageDay()] })
    expect(answer.status).toBe(200)
    expect(forwarded).toHaveLength(0)
  })

  test('still refuses fields outside the allowlist', async () => {
    expect((await send({ events: [daily({ path: '/Users/me' })] })).status).toBe(400)
  })
})
