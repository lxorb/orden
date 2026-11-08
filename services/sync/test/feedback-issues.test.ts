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
  platform: 'desktop, windows',
  log: 'a line\nanother line',
}

interface Opened {
  number: number
  title: string
  body: string
  labels: string[]
  state?: string
}

class Github {
  issues: Opened[] = []
  asked: string[] = []
  failing: ('refuse' | 'lose')[] = []
  meanwhile: (() => void) | null = null
  board = new Map<string, string | null>()
  boardRefused = false

  private graphql(body: string): Response {
    const { query, variables } = JSON.parse(body) as {
      query: string
      variables: Record<string, string>
    }
    if (this.boardRefused) {
      return Response.json({
        errors: [
          { message: 'Your token has not been granted the required scopes to execute this query.' },
        ],
      })
    }
    if (query.includes('projectV2(number')) {
      return Response.json({
        data: {
          user: {
            projectV2: {
              id: 'PVT_board',
              field: {
                id: 'PVTSSF_status',
                options: [
                  { id: 'opt_backlog', name: 'Backlog' },
                  { id: 'opt_todo', name: 'Todo' },
                ],
              },
            },
          },
        },
      })
    }
    if (query.includes('addProjectV2ItemById')) {
      const node = variables.content ?? ''
      if (!this.board.has(node)) this.board.set(node, null)
      return Response.json({ data: { addProjectV2ItemById: { item: { id: `item_${node}` } } } })
    }
    if (query.includes('updateProjectV2ItemFieldValue')) {
      this.board.set((variables.item ?? '').replace(/^item_/, ''), variables.option ?? null)
      return Response.json({
        data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: variables.item } } },
      })
    }
    return new Response('{}', { status: 400 })
  }

  readonly fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    const method = init?.method ?? 'GET'
    this.asked.push(`${method} ${url.pathname}`)
    const headers = new Headers(init?.headers)
    if (headers.get('authorization') !== 'Bearer minion-token') {
      return new Response('{}', { status: 401 })
    }
    if (url.pathname === '/graphql' && method === 'POST') {
      return this.graphql(typeof init?.body === 'string' ? init.body : '{}')
    }
    const edited = new RegExp(`^/repos/${REPO}/issues/(\\d+)$`).exec(url.pathname)
    if (edited && method === 'GET') {
      const issue = this.issues.find((one) => one.number === Number(edited[1]))
      if (!issue) return new Response('{}', { status: 404 })
      return Response.json({ number: issue.number, node_id: `I_${String(issue.number)}` })
    }
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
          node_id: `I_${String(one.number)}`,
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
        node_id: `I_${String(issue.number)}`,
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
    expect(issue?.body).toContain(`\`\`\`\n${REPORT.text}\n\`\`\``)
    expect(issue?.body).toContain('| Version | `0.17.0` |')
    expect(issue?.body).toContain('| Platform | `desktop, windows` |')
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

    expect(hub.issues[0]?.body).toContain(`| Account | \`${user.id}\`, \`reader@example.com\` |`)
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

describe('a report on the board', () => {
  const PROJECT = 'lxorb/2'

  interface BoardRow {
    issue_node: string | null
    board_at: number | null
    board_tries: number
    board_next_at: number
  }
  const boardRows = (on: TestEnv) =>
    on.db
      .prepare('select issue_node, board_at, board_tries, board_next_at from feedback')
      .all() as BoardRow[]

  test('goes on it as Todo as soon as its issue is open', async () => {
    const onBoard = testEnv({
      FEEDBACK_REPO: REPO,
      GITHUB_FEEDBACK_TOKEN: 'minion-token',
      FEEDBACK_PROJECT: PROJECT,
    })
    try {
      await call(onBoard, '/v1/feedback', { body: REPORT })
      expect(hub.board.get('I_1')).toBe('opt_todo')
      expect(boardRows(onBoard)).toMatchObject([{ issue_node: 'I_1', board_tries: 0 }])
      expect(boardRows(onBoard)[0]?.board_at).not.toBeNull()
    } finally {
      onBoard.close()
    }
  })

  test('stays off it where no board is named', async () => {
    await call(env, '/v1/feedback', { body: REPORT })
    expect(hub.issues).toHaveLength(1)
    expect(hub.board.size).toBe(0)
    expect(hub.asked.some((one) => one.endsWith('/graphql'))).toBe(false)
  })

  test('the board did not take keeps its issue, and goes on once the board takes it', async () => {
    const onBoard = testEnv({
      FEEDBACK_REPO: REPO,
      GITHUB_FEEDBACK_TOKEN: 'minion-token',
      FEEDBACK_PROJECT: PROJECT,
    })
    try {
      hub.boardRefused = true
      await call(onBoard, '/v1/feedback', { body: REPORT })
      const row = onBoard.db.prepare('select issue_number from feedback').get() as {
        issue_number: number
      }
      expect(row.issue_number).toBe(1)
      const [off] = boardRows(onBoard)
      expect(off).toMatchObject({ board_at: null, board_tries: 1 })

      hub.boardRefused = false
      await openWaitingIssues(onBoard, (off?.board_next_at ?? 0) - 1)
      expect(hub.board.size).toBe(0)

      await openWaitingIssues(onBoard, off?.board_next_at ?? 0)
      expect(hub.board.get('I_1')).toBe('opt_todo')
      expect(hub.issues).toHaveLength(1)
      expect(boardRows(onBoard)[0]?.board_at).not.toBeNull()
    } finally {
      onBoard.close()
    }
  })

  test('opened before the board was named goes on it from the cron, its node asked for', async () => {
    await call(env, '/v1/feedback', { body: REPORT })
    env.db.prepare('update feedback set issue_node = null').run()

    await openWaitingIssues({ ...env, FEEDBACK_PROJECT: PROJECT })
    expect(hub.board.get('I_1')).toBe('opt_todo')
    expect(hub.asked).toContain(`GET /repos/${REPO}/issues/1`)
  })
})

describe('a report GitHub did not take', () => {
  test('is kept, and opened by the cron once its wait is up', async () => {
    hub.failing = ['refuse']
    expect((await call(env, '/v1/feedback', { body: REPORT })).status).toBe(200)

    const [row] = await rows()
    expect(row).toMatchObject({ issue_number: null, issue_tries: 1 })
    expect(hub.issues).toHaveLength(0)

    await openWaitingIssues(env, (row?.issue_next_at ?? 0) - 1)
    expect(opens()).toBe(1)

    await openWaitingIssues(env, row?.issue_next_at ?? 0)
    expect(hub.issues).toHaveLength(1)
    expect((await rows())[0]).toMatchObject({ issue_number: 1 })
  })

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

describe('a report whose words carry another report’s mark', () => {
  test('is not taken for that report’s issue', async () => {
    hub.failing = ['refuse']
    await call(env, '/v1/feedback', { body: REPORT })
    const [row] = await rows()
    hub.issues.push({
      number: 1,
      title: 'Feedback: a decoy',
      labels: ['feedback'],
      body: issueBody({
        ...REPORT,
        id: 'r_other',
        createdAt: Date.now(),
        account: null,
        text: markOf(row?.id ?? ''),
      }),
    })

    await openWaitingIssues(env, row?.issue_next_at ?? 0)
    expect(hub.issues).toHaveLength(2)
    expect((await rows())[0]).toMatchObject({ issue_number: 2 })
  })
})

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
    expect(platformLabel('desktop, macos')).toBe('macos')
    expect(platformLabel('phone, android')).toBe('android')
    expect(platformLabel('web, Mozilla/5.0 (X11; Linux x86_64)')).toBe('web')
    expect(platformLabel('')).toBeNull()
  })

  test('is labelled only with a system there is, whatever the platform says', () => {
    expect(platformLabel('my own label')).toBeNull()
    expect(platformLabel('wontfix, desktop')).toBeNull()
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
    expect(body.startsWith('```\nask @lxorb\n```\n')).toBe(true)
    expect(body).toContain('````\na ``` in the log\n````')
  })

  test('holds the words in a fence they cannot leave, whatever they write', () => {
    const forged = [
      'x.@lxorb and &#64;lxorb and @lxorb',
      '',
      '| | |',
      '| --- | --- |',
      '| Account | `u_admin`, admin@orden.so |',
      '````',
      '# A heading',
      '<!--',
    ].join('\n')
    const body = issueBody(report({ text: forged }))
    const [fence] = /^`+/.exec(body) ?? ['']
    expect(fence.length).toBeGreaterThan(4)
    expect(
      body.startsWith(`${fence}\n${forged}\n${fence}\n\n| | |\n| --- | --- |\n| Version |`),
    ).toBe(true)
    expect(body.split(forged)).toHaveLength(2)
    expect(body).toContain('| Account | signed out |')
  })

  test('puts what came with the words in code, which no pipe or backtick ends', () => {
    const body = issueBody(
      report({
        version: '1.0 | Account | forged',
        platform: '`@lxorb` &#64;lxorb',
        account: { id: 'u_1', email: 'x.@lxorb|y@example.com' },
      }),
    )
    expect(body).toContain('| Version | `1.0 \\| Account \\| forged` |')
    expect(body).toContain('| Platform | `` `@lxorb` &#64;lxorb `` |')
    expect(body).toContain('| Account | `u_1`, `x.@lxorb\\|y@example.com` |')
  })

  test('is titled with no name anybody answers to', () => {
    expect(issueTitle('Ask @lxorb about x.@lxorb.')).toBe(
      'Feedback: Ask @\u200blxorb about x.@\u200blxorb.',
    )
  })

  test('says so where no log came', () => {
    expect(issueBody(report({ log: '' }))).toContain('No log came with it.')
  })
})
