import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { scriptFrames, titleOf, type CrashReport } from '../src/crash-shape'
import { sweepCrashes } from '../src/crashes'
import { call, signIn, type TestEnv, testEnv } from './harness'

const READER = 'reader-secret'

let env: TestEnv
let next = 0

beforeEach(() => {
  env = testEnv({ CRASH_READER_TOKEN: READER })
})

afterEach(() => env.close())

function idOf(seed: number): string {
  return seed.toString(16).padStart(32, '0')
}

function freeze(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  next++
  return {
    v: 1,
    id: idOf(next),
    kind: 'freeze',
    at: 1_700_000_000_000,
    app: { version: '0.20.1', channel: 'unstable', build: 'abc123' },
    system: { os: 'Windows', osVersion: '10.0.26100', arch: 'x86_64', engine: 'WebView2 131' },
    summary: 'the window stopped answering',
    doing: 'web_open < web_place',
    held: 41_200,
    killed: true,
    threads: [
      {
        name: 'main',
        main: true,
        frames: [
          { module: 'ntdll.dll', offset: '0x9d4c4', symbol: 'NtWaitForSingleObject' },
          { module: 'C:\\Program Files\\Orden\\nib.exe', offset: '0x1a2b3c' },
        ],
      },
      { name: 'tokio-runtime-worker', frames: [{ module: 'nib.exe', offset: '0x55' }] },
    ],
    breadcrumbs: [{ at: 1_699_999_999_000, what: 'opened a web tab' }],
    log: ['a line'],
    open: { windows: 1, kinds: { note: 2, web: 1 } },
    resources: { memory: 512_000_000, cpu: 3.5, uptime: 3600 },
    ...overrides,
  }
}

function panic(where: string, summary: string): Record<string, unknown> {
  return freeze({ kind: 'panic', where, summary, threads: undefined, doing: undefined })
}

async function send(body: unknown, headers: Record<string, string> = {}) {
  return call<{ ok?: boolean; id?: string; error?: string }>(env, '/v1/crashes', {
    body,
    headers,
  })
}

function read<T>(path: string, token: string | null = READER, body?: unknown) {
  return call<T>(env, path, {
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    ...(body === undefined ? {} : { body }),
  })
}

function stored(): { id: string; signature: string; kind: string; body: string | null }[] {
  return env.db
    .prepare('select id, signature, kind, body from crash_reports order by created_at, id')
    .all() as never
}

function groups(): { signature: string; count: number; title: string }[] {
  return env.db
    .prepare('select signature, count, title from crash_groups order by signature')
    .all() as never
}

describe('a crash report', () => {
  test('is kept, grouped and answered with its id', async () => {
    const report = freeze()
    const answer = await send(report)

    expect(answer.status).toBe(200)
    expect(answer.json).toEqual({ ok: true, id: report.id })

    const [row] = stored()
    expect(row?.kind).toBe('freeze')
    expect(row?.signature).toMatch(/^[0-9a-f]{16}$/)
    expect(groups()).toEqual([
      { signature: row?.signature, count: 1, title: '41 s in web_open < web_place, killed' },
    ])
  })

  test('sent again is kept once and still answered', async () => {
    const report = freeze()
    expect((await send(report)).status).toBe(200)
    const again = await send(report)

    expect(again.status).toBe(200)
    expect(again.json).toEqual({ ok: true, id: report.id })
    expect(stored()).toHaveLength(1)
    expect(groups()[0]?.count).toBe(1)
  })

  test('keeps nobody, even from somebody signed in', async () => {
    const token = await signIn(env, 'reader@example.com')
    const answer = await call(env, '/v1/crashes', {
      token,
      body: freeze(),
      headers: { 'cf-connecting-ip': '203.0.113.9' },
    })

    expect(answer.status).toBe(200)
    const body = stored()[0]?.body ?? ''
    expect(body).not.toContain('reader@example.com')
    expect(body).not.toContain('203.0.113.9')
    expect(JSON.stringify(env.db.prepare('select * from limits').all())).not.toContain(
      '203.0.113.9',
    )
  })

  test('drops what it does not know and cuts what is too long', async () => {
    const answer = await send(
      freeze({
        email: 'someone@example.com',
        app: { version: '0.20.1', channel: 'stable', build: 'b', secret: 'x' },
        summary: 'y'.repeat(1000),
        log: ['z'.repeat(3000), ...Array.from({ length: 300 }, () => 'a')],
      }),
    )

    expect(answer.status).toBe(200)
    const kept = JSON.parse(stored()[0]?.body ?? '{}') as CrashReport & Record<string, unknown>
    expect(kept.email).toBeUndefined()
    expect(kept.app).toEqual({ version: '0.20.1', channel: 'stable', build: 'b' })
    expect(kept.summary).toHaveLength(300)
    expect(kept.log).toHaveLength(200)
    expect(kept.log?.[0]).toHaveLength(2000)
    expect(kept.threads?.[0]?.frames[1]?.module).toBe('nib.exe')
  })

  test.each([
    ['no object', 'not json'],
    ['a wrong version', { v: 2 }],
    ['a short id', { id: 'abc' }],
    ['an unknown kind', { kind: 'meltdown' }],
    ['no app', { app: undefined }],
    ['an unknown channel', { app: { version: '1', channel: 'nightly', build: 'b' } }],
    ['a summary that is not text', { summary: 5 }],
    ['frames that are not a list', { threads: [{ name: 'main', frames: 'none' }] }],
  ])('with %s is refused', async (_, change) => {
    const body = typeof change === 'string' ? undefined : freeze(change)
    const answer = await call<{ error?: string }>(env, '/v1/crashes', {
      ...(body
        ? { body }
        : { raw: change as string, headers: { 'content-type': 'application/json' } }),
    })

    expect(answer.status).toBe(400)
    expect(answer.json.error).toBeTruthy()
    expect(stored()).toEqual([])
  })

  test('past 128 KB is refused', async () => {
    const answer = await send(freeze({ stack: 'x'.repeat(130 * 1024) }))
    expect(answer.status).toBe(400)
    expect(stored()).toEqual([])
  })

  test('is counted per machine', async () => {
    const from = { 'cf-connecting-ip': '203.0.113.9' }
    const answers: number[] = []
    for (let one = 0; one < 31; one++) answers.push((await send(freeze(), from)).status)

    expect(answers.slice(0, 30).every((status) => status === 200)).toBe(true)
    expect(answers[30]).toBe(429)
    expect((await send(freeze(), { 'cf-connecting-ip': '203.0.113.10' })).status).toBe(200)
  })

  test('keeps the newest bodies of a group, and counts every one', async () => {
    for (let one = 0; one < 52; one++) {
      env.db.exec(`update crash_reports set created_at = created_at - 1`)
      expect((await send(freeze())).status).toBe(200)
    }

    const rows = stored()
    expect(rows).toHaveLength(52)
    expect(rows.filter((row) => row.body !== null)).toHaveLength(50)
    expect(rows.slice(0, 2).every((row) => row.body === null)).toBe(true)
    expect(groups()[0]?.count).toBe(52)
  })
})

describe('grouping', () => {
  async function signatureOf(report: Record<string, unknown>): Promise<string> {
    expect((await send(report)).status).toBe(200)
    const row = env.db
      .prepare('select signature from crash_reports where id = ?')
      .get(report.id as string) as { signature: string }
    return row.signature
  }

  test('puts one panic in another line in the same group', async () => {
    const one = await signatureOf(panic('src/web_tabs.rs:120:9', 'index 3 out of range for 2'))
    const two = await signatureOf(panic('src/web_tabs.rs:124:13', 'index 7 out of range for 5'))
    const other = await signatureOf(panic('src/web_state.rs:120:9', 'index 3 out of range for 2'))

    expect(two).toBe(one)
    expect(other).not.toBe(one)
  })

  test('puts JS errors with the same stack together, across builds and lines', async () => {
    const stack = (hash: string, line: number) =>
      [
        "TypeError: Cannot read properties of undefined (reading 'x')",
        `    at place (https://orden.so/assets/index-${hash}.js:${line}:17)`,
        `    at async open (https://orden.so/assets/tabs-${hash}.js:9:2)`,
        `    at https://orden.so/assets/index-${hash}.js:1:1`,
      ].join('\n')
    const js = (hash: string, line: number, top = 'place') =>
      freeze({
        kind: 'js',
        threads: undefined,
        summary: "TypeError: Cannot read properties of undefined (reading 'x')",
        stack: stack(hash, line).replace('at place', `at ${top}`),
      })

    const one = await signatureOf(js('AbC12345', 10))
    const two = await signatureOf(js('Zz9_8-7q', 4410))
    const other = await signatureOf(js('AbC12345', 10, 'elsewhere'))

    expect(two).toBe(one)
    expect(other).not.toBe(one)
  })

  test('puts freezes stuck in the same frames together, and others apart', async () => {
    const one = await signatureOf(freeze({ held: 5000 }))
    const two = await signatureOf(freeze({ held: 90_000, killed: false }))
    const doingElse = await signatureOf(freeze({ doing: 'tab_close' }))
    const stuckElse = await signatureOf(
      freeze({
        threads: [{ name: 'main', main: true, frames: [{ module: 'nib.exe', offset: '0x99' }] }],
      }),
    )

    expect(two).toBe(one)
    expect(new Set([one, doingElse, stuckElse]).size).toBe(3)
  })

  test('takes the thread that crashed before the main one', async () => {
    const crashed = (offset: string) =>
      freeze({
        kind: 'crash',
        doing: undefined,
        threads: [
          { name: 'main', main: true, frames: [{ module: 'nib.exe', offset: '0x1' }] },
          { name: 'worker', crashed: true, frames: [{ module: 'nib.exe', offset }] },
        ],
      })

    expect(await signatureOf(crashed('0x10'))).not.toBe(await signatureOf(crashed('0x20')))
  })

  test('groups engine troubles by process and reason', async () => {
    const engine = (process: string, reason: string) =>
      freeze({ kind: 'engine', threads: undefined, process, reason })

    const one = await signatureOf(engine('renderer', 'unresponsive'))
    expect(await signatureOf(engine('renderer', 'unresponsive'))).toBe(one)
    expect(await signatureOf(engine('gpu', 'unresponsive'))).not.toBe(one)
  })
})

describe('the titles', () => {
  test('say what happened in a line', () => {
    const base = freeze() as unknown as CrashReport
    expect(titleOf(base)).toBe('41 s in web_open < web_place, killed')
    expect(titleOf({ ...base, kind: 'panic', where: 'src/a.rs:1:2', summary: 'boom' })).toBe(
      'boom at src/a.rs',
    )
    expect(titleOf({ ...base, kind: 'engine', process: 'renderer', reason: 'crashed' })).toBe(
      'renderer crashed',
    )
  })

  test('read frames of both engines', () => {
    expect(
      scriptFrames(
        [
          'Error: x',
          '    at a (https://h/assets/index-AbC12345.js:1:2)',
          'b@https://h/assets/web-tabs-AbC12345.js?v=3:5:6',
          '    at https://h/c.js:3:4',
          '    at d (https://h/d.js:1:1)',
        ].join('\n'),
      ),
    ).toEqual(['a index.js', 'b web-tabs.js', '<anonymous> c.js'])
  })
})

describe('reading the reports', () => {
  test('is not there without the token, or where no token is set', async () => {
    await send(freeze())

    expect((await read('/v1/crashes/groups', null)).status).toBe(404)
    expect((await read('/v1/crashes/groups', 'wrong')).status).toBe(404)
    expect((await read(`/v1/crashes/${idOf(next)}`, null)).status).toBe(404)

    const bare = testEnv()
    const answer = await call(bare, '/v1/crashes/groups', {
      headers: { authorization: 'Bearer anything' },
    })
    expect(answer.status).toBe(404)
    bare.close()
  })

  test('lists groups, the reports of one, and a whole report', async () => {
    await send(freeze())
    await send(freeze({ app: { version: '0.20.2', channel: 'stable', build: 'b' } }))
    await send(panic('src/a.rs:1:1', 'boom'))

    const listed = await read<{
      groups: { signature: string; kind: string; count: number; versions: string[] }[]
    }>('/v1/crashes/groups')
    expect(listed.status).toBe(200)
    const frozen = listed.json.groups.find((group) => group.kind === 'freeze')
    expect(frozen?.count).toBe(2)
    expect(frozen?.versions).toEqual(['0.20.1', '0.20.2'])
    expect(listed.json.groups).toHaveLength(2)

    const reports = await read<{ reports: { id: string }[] }>(
      `/v1/crashes?group=${frozen?.signature ?? ''}`,
    )
    expect(reports.json.reports).toHaveLength(2)

    const whole = await read<{ report: CrashReport; group: { count: number } }>(
      `/v1/crashes/${reports.json.reports[0]?.id ?? ''}`,
    )
    expect(whole.status).toBe(200)
    expect(whole.json.report.doing).toBe('web_open < web_place')
    expect(whole.json.group.count).toBe(2)

    const later = await read<{ groups: unknown[] }>(`/v1/crashes/groups?since=${Date.now() + 1000}`)
    expect(later.json.groups).toEqual([])
  })

  test('notes the issue a group became', async () => {
    await send(freeze())
    const signature = groups()[0]?.signature ?? ''
    const url = 'https://github.com/lxorb/orden/issues/9'

    const noted = await read(`/v1/crashes/groups/${signature}/issue`, READER, { number: 9, url })
    expect(noted.status).toBe(200)

    const listed = await read<{ groups: { issue: unknown }[] }>('/v1/crashes/groups')
    expect(listed.json.groups[0]?.issue).toEqual({ number: 9, url })

    expect(
      (await read(`/v1/crashes/groups/${signature}/issue`, null, { number: 9, url })).status,
    ).toBe(404)
    expect(
      (await read('/v1/crashes/groups/0000000000000000/issue', READER, { number: 9, url })).status,
    ).toBe(404)
    expect(
      (await read(`/v1/crashes/groups/${signature}/issue`, READER, { number: 'x', url })).status,
    ).toBe(400)
  })
})

describe('the daily sweep', () => {
  test('forgets reports past ninety days and keeps their groups', async () => {
    await send(freeze())
    await send(freeze())
    const day = 24 * 60 * 60 * 1000
    env.db.exec(`update crash_reports set created_at = ${Date.now() - 91 * day} where rowid = 1`)

    await sweepCrashes(env, Date.now())

    expect(stored()).toHaveLength(1)
    expect(groups()[0]?.count).toBe(2)
  })
})
