import { describe, expect, test } from 'vitest'
import type { AliasFetcher } from './aliases'
import { aliasClient, AliasRefused } from './aliases'

interface Asked {
  method: string
  url: string
  headers: Record<string, string>
  body: unknown
}

type Reply = [status: number, body: unknown]

function fake(replies: Record<string, Reply | ((asked: Asked) => Reply)>): {
  fetcher: AliasFetcher
  asked: Asked[]
} {
  const asked: Asked[] = []
  const fetcher: AliasFetcher = (input, init) => {
    const one: Asked = {
      method: init.method ?? 'GET',
      url: input,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
    }
    asked.push(one)
    const path = new URL(input).pathname
    const found = replies[`${one.method} ${path}`]
    const [status, body] = typeof found === 'function' ? found(one) : (found ?? [404, {}])
    return Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status }))
  }
  return { fetcher, asked }
}

const SL_ALIAS = {
  id: 3,
  email: 'shop.cat@slmail.me',
  name: 'Shop',
  enabled: true,
  note: null,
  mailboxes: [{ id: 1, email: 'me@example.com' }],
}

const SL_MAILBOXES: Reply = [
  200,
  {
    mailboxes: [
      { id: 1, email: 'me@example.com', default: true },
      { id: 2, email: 'work@example.com', default: false },
    ],
  },
]

describe('SimpleLogin', () => {
  test('lists the mailboxes with the key in its own header', async () => {
    const { fetcher, asked } = fake({ 'GET /api/v2/mailboxes': SL_MAILBOXES })
    const boxes = await aliasClient('simplelogin', 'sl-key', fetcher).mailboxes()
    expect(boxes).toEqual([
      { id: '1', email: 'me@example.com', isDefault: true },
      { id: '2', email: 'work@example.com', isDefault: false },
    ])
    expect(asked[0]?.url).toBe('https://app.simplelogin.io/api/v2/mailboxes')
    expect(asked[0]?.headers.Authentication).toBe('sl-key')
    expect(asked[0]?.headers.Authorization).toBeUndefined()
  })

  test('offers the suffixes and the prefix for a site', async () => {
    const { fetcher, asked } = fake({
      'GET /api/v5/alias/options': [
        200,
        {
          can_create: true,
          prefix_suggestion: 'shop',
          suffixes: [
            { suffix: '.cat@slmail.me', signed_suffix: '.cat@slmail.me.X.sig', is_premium: false },
            { suffix: '@me.dev', 'signed-suffix': '@me.dev.X.sig', is_premium: true },
          ],
        },
      ],
      'GET /api/v2/mailboxes': SL_MAILBOXES,
    })
    const options = await aliasClient('simplelogin', 'k', fetcher).options('shop.example.com')
    expect(asked[0]?.url).toBe(
      'https://app.simplelogin.io/api/v5/alias/options?hostname=shop.example.com',
    )
    expect(options).toMatchObject({
      prefix: 'shop',
      canCreate: true,
      suffixes: [
        { value: '.cat@slmail.me.X.sig', label: '.cat@slmail.me', premium: false },
        { value: '@me.dev.X.sig', label: '@me.dev', premium: true },
      ],
    })
    expect(options.mailboxes).toHaveLength(2)
  })

  test('makes an alias from a prefix and a signed suffix', async () => {
    const { fetcher, asked } = fake({ 'POST /api/v3/alias/custom/new': [201, SL_ALIAS] })
    const made = await aliasClient('simplelogin', 'k', fetcher).create(
      { prefix: 'shop', suffix: '.cat@slmail.me.X.sig', mailboxes: ['1'], name: 'Shop', note: 'n' },
      'shop.example.com',
    )
    expect(asked[0]?.method).toBe('POST')
    expect(asked[0]?.url).toContain('hostname=shop.example.com')
    expect(asked[0]?.body).toEqual({
      alias_prefix: 'shop',
      signed_suffix: '.cat@slmail.me.X.sig',
      mailbox_ids: [1],
      note: 'n',
      name: 'Shop',
    })
    expect(made).toEqual({
      remoteId: '3',
      address: 'shop.cat@slmail.me',
      enabled: true,
      mailboxes: ['me@example.com'],
      name: 'Shop',
      note: '',
    })
  })

  test('makes a random alias', async () => {
    const { fetcher, asked } = fake({ 'POST /api/alias/random/new': [201, SL_ALIAS] })
    const made = await aliasClient('simplelogin', 'k', fetcher).random('for shop')
    expect(asked[0]?.body).toEqual({ note: 'for shop' })
    expect(made.address).toBe('shop.cat@slmail.me')
  })

  test('toggles to the state asked for, twice when it was already there', async () => {
    let enabled = true
    const { fetcher, asked } = fake({
      'POST /api/aliases/3/toggle': () => {
        enabled = !enabled
        return [200, { enabled }]
      },
    })
    const client = aliasClient('simplelogin', 'k', fetcher)
    expect(await client.setEnabled('3', false)).toBe(false)
    expect(asked).toHaveLength(1)
    expect(await client.setEnabled('3', false)).toBe(false)
    expect(asked).toHaveLength(3)
  })

  test('deletes an alias', async () => {
    const { fetcher, asked } = fake({ 'DELETE /api/aliases/3': [200, { deleted: true }] })
    await aliasClient('simplelogin', 'k', fetcher).remove('3')
    expect(asked[0]?.method).toBe('DELETE')
  })

  test('counts the last 14 days of activity across pages and stops at older ones', async () => {
    const now = 100 * 86_400_000
    const at = (days: number) => (now - days * 86_400_000) / 1000
    const { fetcher, asked } = fake({
      'GET /api/aliases/3/activities': (one) => {
        const page = new URL(one.url).searchParams.get('page_id')
        if (page === '0') {
          return [
            200,
            {
              activities: [
                { action: 'forward', timestamp: at(1) },
                { action: 'forward', timestamp: at(2) },
                { action: 'reply', timestamp: at(3) },
              ],
            },
          ]
        }
        return [
          200,
          {
            activities: [
              { action: 'block', timestamp: at(5) },
              { action: 'bounced', timestamp: at(6) },
              { action: 'forward', timestamp: at(20) },
            ],
          },
        ]
      },
    })
    const stats = await aliasClient('simplelogin', 'k', fetcher).stats('3', now)
    expect(stats).toEqual({ forwarded: 2, replied: 1, blocked: 1, days: 14 })
    expect(asked).toHaveLength(2)
  })

  test('is refused with the service’s words on a wrong key, never the key', async () => {
    const { fetcher } = fake({ 'GET /api/v2/mailboxes': [401, { error: 'Wrong api key' }] })
    const asking = aliasClient('simplelogin', 'secret-key', fetcher).mailboxes()
    await expect(asking).rejects.toBeInstanceOf(AliasRefused)
    await expect(asking).rejects.toMatchObject({ status: 401, message: 'Wrong api key' })
    await expect(asking).rejects.not.toThrow('secret-key')
  })

  test('throws on an answer it cannot read', async () => {
    const { fetcher } = fake({ 'POST /api/alias/random/new': [201, { email: 3 }] })
    await expect(aliasClient('simplelogin', 'k', fetcher).random('')).rejects.toThrow(
      'unreadable alias answer',
    )
  })
})

const ADDY_ALIAS = {
  data: {
    id: '50c9e585',
    email: 'shop.x1y2z@anonaddy.me',
    active: true,
    description: 'for shop',
    from_name: null,
    recipients: [],
    emails_forwarded: 5,
    emails_blocked: 1,
    emails_replied: 2,
  },
}

const ADDY_DOMAINS: Reply = [
  200,
  {
    data: ['anonaddy.me', 'me.anonaddy.com'],
    sharedDomains: ['anonaddy.me'],
    defaultAliasDomain: 'me.anonaddy.com',
    defaultAliasFormat: 'random_words',
  },
]

const ADDY_RECIPIENTS: Reply = [
  200,
  {
    data: [
      { id: 'r1', email: 'me@example.com' },
      { id: 'r2', email: 'work@example.com' },
    ],
  },
]

describe('addy.io', () => {
  test('lists the recipients with the bearer key and marks the default one', async () => {
    const { fetcher, asked } = fake({
      'GET /api/v1/recipients': ADDY_RECIPIENTS,
      'GET /api/v1/account-details': [200, { data: { default_recipient_id: 'r2' } }],
    })
    const boxes = await aliasClient('addy', 'addy-key', fetcher).mailboxes()
    expect(boxes).toEqual([
      { id: 'r1', email: 'me@example.com', isDefault: false },
      { id: 'r2', email: 'work@example.com', isDefault: true },
    ])
    expect(asked[0]?.headers).toMatchObject({
      Authorization: 'Bearer addy-key',
      'X-Requested-With': 'XMLHttpRequest',
    })
    expect(asked[0]?.url.startsWith('https://app.addy.io/api/v1/recipients')).toBe(true)
  })

  test('offers its domains, the default first, and a prefix from the site', async () => {
    const { fetcher } = fake({
      'GET /api/v1/domain-options': ADDY_DOMAINS,
      'GET /api/v1/recipients': ADDY_RECIPIENTS,
      'GET /api/v1/account-details': [200, { data: { default_recipient_id: 'r1' } }],
    })
    const options = await aliasClient('addy', 'k', fetcher).options('www.shop.co.uk')
    expect(options.prefix).toBe('shop')
    expect(options.suffixes).toEqual([
      { value: 'me.anonaddy.com', label: '@me.anonaddy.com', premium: false },
      { value: 'anonaddy.me', label: '@anonaddy.me', premium: false },
    ])
    expect(options.canCreate).toBe(true)
  })

  test('makes a custom alias and names its sender', async () => {
    const { fetcher, asked } = fake({
      'POST /api/v1/aliases': [201, ADDY_ALIAS],
      'PATCH /api/v1/aliases/50c9e585': [200, ADDY_ALIAS],
    })
    const made = await aliasClient('addy', 'k', fetcher).create({
      prefix: 'shop',
      suffix: 'anonaddy.me',
      mailboxes: ['r1'],
      name: 'Shop',
      note: 'for shop',
    })
    expect(asked[0]?.body).toEqual({
      domain: 'anonaddy.me',
      description: 'for shop',
      format: 'custom',
      local_part: 'shop',
      recipient_ids: ['r1'],
    })
    expect(asked[1]?.body).toEqual({ from_name: 'Shop' })
    expect(made).toEqual({
      remoteId: '50c9e585',
      address: 'shop.x1y2z@anonaddy.me',
      enabled: true,
      mailboxes: [],
      name: 'Shop',
      note: 'for shop',
    })
  })

  test('makes a random alias on the default domain', async () => {
    const { fetcher, asked } = fake({
      'GET /api/v1/domain-options': ADDY_DOMAINS,
      'POST /api/v1/aliases': [201, ADDY_ALIAS],
    })
    await aliasClient('addy', 'k', fetcher).random('note')
    expect(asked[1]?.body).toEqual({ domain: 'me.anonaddy.com', description: 'note' })
  })

  test('turns an alias on and off', async () => {
    const { fetcher, asked } = fake({
      'POST /api/v1/active-aliases': [200, ADDY_ALIAS],
      'DELETE /api/v1/active-aliases/50c9e585': [204, null],
    })
    const client = aliasClient('addy', 'k', fetcher)
    expect(await client.setEnabled('50c9e585', true)).toBe(true)
    expect(asked[0]?.body).toEqual({ id: '50c9e585' })
    expect(await client.setEnabled('50c9e585', false)).toBe(false)
    expect(asked[1]?.method).toBe('DELETE')
  })

  test('deletes an alias', async () => {
    const { fetcher, asked } = fake({ 'DELETE /api/v1/aliases/50c9e585': [204, null] })
    await aliasClient('addy', 'k', fetcher).remove('50c9e585')
    expect(asked[0]?.url).toBe('https://app.addy.io/api/v1/aliases/50c9e585')
  })

  test('gives its counts for all time', async () => {
    const { fetcher } = fake({ 'GET /api/v1/aliases/50c9e585': [200, ADDY_ALIAS] })
    expect(await aliasClient('addy', 'k', fetcher).stats('50c9e585')).toEqual({
      forwarded: 5,
      replied: 2,
      blocked: 1,
      days: null,
    })
  })

  test('is refused with its message', async () => {
    const { fetcher } = fake({ 'POST /api/v1/aliases': [403, { message: 'Limit reached' }] })
    await expect(
      aliasClient('addy', 'k', fetcher).create({
        prefix: '',
        suffix: 'anonaddy.me',
        mailboxes: [],
        name: '',
        note: '',
      }),
    ).rejects.toMatchObject({ status: 403, message: 'Limit reached' })
  })
})
