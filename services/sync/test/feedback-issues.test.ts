/** A report sent with Send feedback, as an issue in the private repository (#666),
 *  against a GitHub that lives in this file: the issue opened with all of the report, its
 *  log cut to GitHub's limit, a try that failed tried again from the cron, and never two
 *  issues for one report. */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  issueBody,
  issueTitle,
  markOf,
  MOST_BODY,
  openWaitingIssues,
  platformLabel,
  type Report,
} from '../src/feedback-issues'
import { sweepLeftovers } from '../src/leftovers'
import { call, mail, signIn, type TestEnv, testEnv } from './harness'

const REPO = 'lxorb/orden-feedback'

const REPORT = {
  text: 'The tab strip lost its line. It came back after a restart.',
  version: '0.17.0',
  platform: 'desktop · windows',
  log: 'a line\nanother line',
}

interface Opened {
  number: number
  title: string
  body: string
  labels: string[]
  state?: string
}

/** GitHub's issues of the one repository, and what each request asked. */
class Github {
  issues: Opened[] = []
  asked: string[] = []
  /** What the next requests to open an issue do instead of answering: fail outright,
   *  or open it and lose the answer on its way back. */
  failing: ('refuse' | 'lose')[] = []
  /** Run while an issue is being opened, before it is: what else happens meanwhile. */
  meanwhile: (() => void) | null = null

  readonly fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    const method = init?.method ?? 'GET'
    this.asked.push(`${method} ${url.pathname}`)
    const headers = new Headers(init?.headers)
    if (headers.get('authorization') !== 'Bearer minion-token') {
      return new Response('{}', { status: 401 })
    }
    const edited = new RegExp(`^/repos/${REPO}/issues/(\\d+)$`).exec(url.pathname)
    if (edited && method === 'PATCH') {
      const issue = this.issues.find((one) => one.number === Number(edited[1]))
      if (!issue) return new Response('{}', { status: 404 })
      Object.assign(issue, JSON.parse(typeof init?.body === 'string' ? init.body : '{}'))
      return Response.json({ number: issue.number })
    }
    if (url.pathname !== `/repos/${REPO}/issues`) return new Response('{}', { status: 404 })

    if (method === 'GET') {
      const page = Number(url.searchParams.get('page') ?? 1)
      const listed = this.issues.slice((page - 1) * 100, page * 100)
      return Response.json(
        listed.map((one) => ({
          number: one.number,
          html_url: `https://github.com/${REPO}/issues/${String(one.number)}`,
          body: one.body,
        })),
      )
    }

    this.meanwhile?.()
    const failure = this.failing.shift()
    if (failure === 'refuse') return new Response('{}', { status: 502 })
    const sent = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Omit<
      Opened,
      'number'
    >
    const issue = { number: this.issues.length + 1, ...sent }
    this.issues.push(issue)
    if (failure === 'lose') throw new Error('the connection dropped')
    return Response.json(
      {
        number: issue.number,
        html_url: `https://github.com/${REPO}/issues/${String(issue.number)}`,
      },
      { status: 201 },
    )
  }
}

let env: TestEnv
let hub: Github

beforeEach(() => {
  hub = new Github()
  vi.stubGlobal('fetch', hub.fetch)
  env = testEnv({ FEEDBACK_REPO: REPO, GITHUB_FEEDBACK_TOKEN: 'minion-token' })
})

afterEach(() => {
  vi.unstubAllGlobals()
  env.close()
})

interface Row {
  id: string
  issue_number: number | null
  issue_url: string | null
  issue_tries: number
  issue_next_at: number
}

async function rows(): Promise<Row[]> {
  const read = await env.DB.prepare(
    'select id, issue_number, issue_url, issue_tries, issue_next_at from feedback',
  ).all<Row>()
  return read.results
}

const opens = () => hub.asked.filter((one) => one.startsWith('POST')).length

describe('a report', () => {
  test('becomes an issue with everything in it, and the row says which', async () => {
    const answer = await call<{ id: string }>(env, '/v1/feedback', { body: REPORT })
    expect(answer.status).toBe(200)

    expect(hub.issues).toHaveLength(1)
    const [issue] = hub.issues
    expect(issue?.title).toBe('Feedback: The tab strip lost its line.')
    expect(issue?.labels).toEqual(['feedback', 'windows'])
    expect(issue?.body).toContain(REPORT.text)
    expect(issue?.body).toContain('| Version | 0.17.0 |')
    expect(issue?.body).toContain('| Platform | desktop · windows |')
    expect(issue?.body).toContain('| Account | signed out |')
    expect(issue?.body).toContain(`| Report | \`${answer.json.id}\` |`)
    expect(issue?.body).toContain('<details><summary>Recent app log</summary>')
    expect(issue?.body).toContain('a line\nanother line')

    expect(await rows()).toMatchObject([
      { issue_number: 1, issue_url: `https://github.com/${REPO}/issues/1`, issue_tries: 0 },
    ])
  })

  test('from somebody signed in says whose it is', async () => {
    const token = await signIn(env, 'reader@example.com')
    await call(env, '/v1/feedback', { token, body: REPORT })
    const user = env.db
      .prepare('select id from users where email = ?')
      .get('reader@example.com') as {
      id: string
    }

    expect(hub.issues[0]?.body).toContain(`| Account | \`${user.id}\` · reader@example.com |`)
  })

  test('is kept and waits where no token is set yet, and is opened once there is one', async () => {
    const waiting = testEnv({ FEEDBACK_REPO: REPO })
    try {
      expect((await call(waiting, '/v1/feedback', { body: REPORT })).status).toBe(200)
      expect(hub.asked).toEqual([])

      await openWaitingIssues({ ...waiting, GITHUB_FEEDBACK_TOKEN: 'minion-token' })
      expect(hub.issues).toHaveLength(1)
      const row = waiting.db.prepare('select issue_number from feedback').get() as {
        issue_number: number
      }
      expect(row.issue_number).toBe(1)
    } finally {
      waiting.close()
    }
  })
})

describe('a report GitHub did not take', () => {
  test('is kept, and opened by the cron once its wait is up', async () => {
    hub.failing = ['refuse']
    expect((await call(env, '/v1/feedback', { body: REPORT })).status).toBe(200)

    const [row] = await rows()
    expect(row).toMatchObject({ issue_number: null, issue_tries: 1 })
    expect(hub.issues).toHaveLength(0)

    // Not before its time.
    await openWaitingIssues(env, (row?.issue_next_at ?? 0) - 1)
    expect(opens()).toBe(1)

    await openWaitingIssues(env, row?.issue_next_at ?? 0)
    expect(hub.issues).toHaveLength(1)
    expect((await rows())[0]).toMatchObject({ issue_number: 1 })
  })

  /** The issue opened and its answer lost: the next try finds it by the report's mark
   *  rather than opening a second. */
  test('whose issue opened without its answer coming back becomes no second issue', async () => {
    hub.failing = ['lose']
    await call(env, '/v1/feedback', { body: REPORT })
    expect(hub.issues).toHaveLength(1)
    const [row] = await rows()
    expect(row).toMatchObject({ issue_number: null, issue_tries: 1 })

    await openWaitingIssues(env, (row?.issue_next_at ?? 0) + 1)
    expect(hub.issues).toHaveLength(1)
    expect(opens()).toBe(1)
    expect((await rows())[0]).toMatchObject({ issue_number: 1 })
  })

  test('is not opened twice by two runs at once, nor again once it has its issue', async () => {
    hub.failing = ['refuse']
    await call(env, '/v1/feedback', { body: REPORT })
    const at = ((await rows())[0]?.issue_next_at ?? 0) + 1

    await Promise.all([openWaitingIssues(env, at), openWaitingIssues(env, at)])
    await openWaitingIssues(env, at + 60_000)
    expect(hub.issues).toHaveLength(1)
    expect(opens()).toBe(2)
  })
})

/** An account deleted through the routes, all three steps. */
async function leave(token: string): Promise<void> {
  const mailed = await mail(() => call(env, '/v1/account/delete/code', { token, body: {} }))
  const found = /(\d{3}) (\d{3})/.exec(mailed)
  const verified = await call<{ ticket: string }>(env, '/v1/account/delete/verify', {
    token,
    body: { code: `${found?.[1] ?? ''}${found?.[2] ?? ''}` },
  })
  const gone = await call(env, '/v1/account', {
    method: 'DELETE',
    token,
    body: { ticket: verified.json.ticket },
  })
  expect(gone.status).toBe(200)
}

describe('a report whose account is deleted', () => {
  test('leaves nothing of it in the issue it became', async () => {
    const token = await signIn(env, 'reader@example.com')
    await call(env, '/v1/feedback', { token, body: REPORT })
    expect(hub.issues[0]?.body).toContain('reader@example.com')

    await leave(token)

    const [issue] = hub.issues
    expect(issue?.state).toBe('closed')
    expect(JSON.stringify(issue)).not.toContain('reader@example.com')
    expect(JSON.stringify(issue)).not.toContain('tab strip')
    expect(JSON.stringify(issue)).not.toContain('another line')
    expect(env.db.prepare("select what from leftovers where what like 'issues/%'").all()).toEqual(
      [],
    )
  })

  test('and is redacted the next night where GitHub did not answer the first time', async () => {
    const token = await signIn(env, 'reader@example.com')
    await call(env, '/v1/feedback', { token, body: REPORT })
    const working = hub.fetch
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'PATCH' ? new Response('{}', { status: 502 }) : working(input, init),
    )

    await leave(token)
    expect(hub.issues[0]?.body).toContain('reader@example.com')

    vi.stubGlobal('fetch', working)
    await sweepLeftovers(env)
    expect(hub.issues[0]?.body).not.toContain('reader@example.com')
    expect(hub.issues[0]?.state).toBe('closed')
  })

  test('while its issue is being opened leaves nothing of it there either', async () => {
    const token = await signIn(env, 'reader@example.com')
    hub.failing = ['refuse']
    await call(env, '/v1/feedback', { token, body: REPORT })
    const at = ((await rows())[0]?.issue_next_at ?? 0) + 1

    // The account goes between the run taking the report on and GitHub opening it.
    hub.meanwhile = () => {
      hub.meanwhile = null
      env.db.prepare('delete from feedback').run()
    }
    await openWaitingIssues(env, at)

    expect(hub.issues).toHaveLength(1)
    expect(hub.issues[0]?.state).toBe('closed')
    expect(JSON.stringify(hub.issues[0])).not.toContain('reader@example.com')
    expect(JSON.stringify(hub.issues[0])).not.toContain('tab strip')
  })
})

describe('the issue', () => {
  const report = (over: Partial<Report> = {}): Report => ({
    id: 'r1',
    ...REPORT,
    createdAt: Date.UTC(2026, 9, 20, 12),
    account: null,
    ...over,
  })

  test('is titled with the first sentence, and cut where that is long', () => {
    expect(issueTitle('It froze! Again.')).toBe('Feedback: It froze!')
    expect(issueTitle('no full stop at all')).toBe('Feedback: no full stop at all')
    expect(issueTitle('x'.repeat(200))).toHaveLength('Feedback: '.length + 80)
  })

  test('is labelled with the system it came from', () => {
    expect(platformLabel('desktop · macos')).toBe('macos')
    expect(platformLabel('phone · android')).toBe('android')
    expect(platformLabel('web · Mozilla/5.0 (X11; Linux x86_64)')).toBe('web')
    expect(platformLabel('')).toBeNull()
  })

  test('keeps the end of a log too long for GitHub, and says what was cut', () => {
    const log = `${'old line\n'.repeat(20_000)}the last line`
    const body = issueBody(report({ log }))

    expect(body.length).toBeLessThanOrEqual(MOST_BODY)
    expect(body).toContain('characters cut from the start')
    expect(body).toContain('the last line')
    expect(body).toContain(markOf('r1'))
  })

  test('pings nobody, and a log cannot close its own fence', () => {
    const body = issueBody(report({ text: 'ask @lxorb', log: 'a ``` in the log' }))
    expect(body).not.toContain('@lxorb')
    expect(body).toContain('````\na ``` in the log\n````')
  })

  test('says so where no log came', () => {
    expect(issueBody(report({ log: '' }))).toContain('No log came with it.')
  })
})
