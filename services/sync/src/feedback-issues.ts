/** A report sent with Send feedback, as an issue in a private repository (#666).
 *
 *  Issues in a public repository are public, so reports go to `FEEDBACK_REPO`, which
 *  only its collaborators can read, opened as lxorbs-minion with `GITHUB_FEEDBACK_TOKEN`.
 *  The issue carries all of the report: the words, the version and the platform, whose
 *  it is, its id and its time, and the log, folded away and cut from its start to fit
 *  GitHub's limit on a body.
 *
 *  The row in D1 (0055) is the report; the issue is a copy of it, and its number and
 *  address go on the row once it is open (0058). Opening one is tried the moment the
 *  report arrives and again from the cron while it has not worked - GitHub out of
 *  reach, or no token set yet - so no report is lost. And none becomes two issues: a
 *  run takes a report on by writing its claim first, and one that finds a report tried
 *  before looks for the issue an earlier try may have opened without hearing back, by
 *  the report's id in its body, before it opens another.
 *
 *  Everything in the issue that somebody typed - the words, and the version, the
 *  platform and the address the app sends with them - goes in as code: the words in a
 *  fence they cannot close, the rest in code spans (#785). Code is the one thing GitHub
 *  draws exactly as written: no mention in it pings anybody however its at sign is
 *  spelled (`x.@lxorb`, `&#64;lxorb`), no table or heading or comment in it is one, so
 *  a report can neither reach a person through the repository nor dress itself as the
 *  table the app adds or hide that table. The title, which GitHub draws as text, has
 *  every at sign broken.
 *
 *  Once open, the issue goes on the project board `FEEDBACK_PROJECT` names, as Todo, so a
 *  report is in the same queue as the rest of the work. The board is public; an issue
 *  of a private repository shows on it only to those who may read that repository. A
 *  board that did not take it is tried again from the cron, apart from the issue, which
 *  stays open whatever the board does.
 *
 *  Deleting the account a report came from deletes the report (erase.ts), and the issue
 *  goes with it as far as this token can take it: closed, and its title and body
 *  written over with nothing of the report, from the list of what an account leaves
 *  behind (src/leftovers.ts). Deleting the issue itself takes an admin of the
 *  repository, which the minion is not. */

import { now } from './crypto'
import { oneLine } from './email'
import type { Env } from './types'

const API = 'https://api.github.com'

/** GitHub's limit on an issue's body, in characters. */
export const MOST_BODY = 65_536

/** Room kept below it, for what a count of characters and GitHub's own may differ by. */
const SPARE = 512

/** How long a claim holds: past it, the run that wrote it is taken to be gone. */
const CLAIM = 5 * 60 * 1000

/** The longest wait between two tries, and the first. */
const FIRST_WAIT = 60 * 1000
const LONGEST_WAIT = 6 * 60 * 60 * 1000

/** How many waiting reports one run of the cron takes on. */
const AT_ONCE = 10

/** The mark in an issue's body that says which report it is, for finding it again. */
export function markOf(id: string): string {
  return `<!-- orden-feedback:${id} -->`
}

export interface Report {
  id: string
  text: string
  version: string
  platform: string
  log: string
  createdAt: number
  /** The account it came from, or null from somebody signed out. */
  account: { id: string; email: string } | null
}

/** The issue's title: the report's first sentence, every at sign in it followed by a
 *  zero-width space, so no part of it is a name. */
export function issueTitle(text: string): string {
  const line = oneLine(text)
  const sentence = /^(.+?[.!?])(?:\s|$)/.exec(line)?.[1] ?? line
  const said = sentence.length > 80 ? `${sentence.slice(0, 79)}…` : sentence
  return `Feedback: ${said.replace(/@/g, '@\u200b')}`
}

/** The labels a report may carry beside `feedback`: the systems the app runs on. The
 *  platform is the app's to say, so anything else is no label - a label it named would
 *  be made in the repository. */
const SYSTEMS = ['macos', 'windows', 'linux', 'ios', 'android'] as const

/** The platform as a label: the system where the app is native, `web` in a browser. */
export function platformLabel(platform: string): string | null {
  const said = platform.toLowerCase()
  if (said.startsWith('web')) return 'web'
  return SYSTEMS.find((system) => said.includes(system)) ?? null
}

/** The longest run of backticks in `text`. */
function longestTicks(text: string): number {
  return Math.max(0, ...[...text.matchAll(/`+/g)].map((run) => run[0].length))
}

/** A value for one cell of the table, as code: one line, in a span its own backticks
 *  cannot end, and with its pipes escaped, which a table reads before the span. */
function cell(text: string): string {
  const line = oneLine(text)
  if (!line) return '-'
  const ticks = '`'.repeat(longestTicks(line) + 1)
  // A space inside the span where the value starts or ends with a backtick, which
  // CommonMark takes off again.
  const pad = line.startsWith('`') || line.endsWith('`') ? ' ' : ''
  return `${ticks}${pad}${line.replace(/\|/g, '\\|')}${pad}${ticks}`
}

/** A fence the text inside it cannot close: longer than any run of backticks in it. */
function fenced(text: string): string {
  const fence = '`'.repeat(Math.max(2, longestTicks(text)) + 1)
  return `${fence}\n${text}\n${fence}`
}

/** The issue's body: the words, the table of what the app added, and the log folded
 *  away, cut from its start where the whole would be past GitHub's limit. */
export function issueBody(report: Report): string {
  const account = report.account
    ? `\`${report.account.id}\` · ${cell(report.account.email)}`
    : 'signed out'
  const head = `${fenced(report.text)}

| | |
| --- | --- |
| Version | ${cell(report.version || 'unknown')} |
| Platform | ${cell(report.platform || 'unknown')} |
| Account | ${account} |
| Report | \`${report.id}\` |
| Sent | ${new Date(report.createdAt).toISOString()} |

`
  const tail = `\n\n${markOf(report.id)}\n`
  if (!report.log) return `${head}No log came with it.${tail}`

  const open = '<details><summary>Recent app log</summary>\n\n'
  const close = '\n\n</details>'
  const room = MOST_BODY - SPARE - head.length - open.length - close.length - tail.length - 16
  let log = report.log
  if (log.length > room) {
    const cut = log.length - room + 80
    log = `… ${String(cut)} characters cut from the start\n${log.slice(cut)}`
  }
  return `${head}${open}${fenced(log)}${close}${tail}`
}

interface Github {
  token: string
  repo: string
}

function github(env: Env): Github | null {
  const token = env.GITHUB_FEEDBACK_TOKEN?.trim()
  const repo = env.FEEDBACK_REPO?.trim()
  return token && repo ? { token, repo } : null
}

function asked(to: Github, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${to.token}`,
      'user-agent': 'orden-sync',
      'x-github-api-version': '2022-11-28',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    signal: AbortSignal.timeout(10_000),
  })
}

interface Issue {
  number: number
  html_url: string
  /** What GitHub's GraphQL knows it by, for putting it on the board. */
  node_id: string
  body?: string | null
}

/** Whether `body` is the issue of report `id`: its mark the body's last line, where the
 *  app puts it. Anywhere else it is somebody's words saying it, which must not take
 *  another report's place (#785). */
function isMarked(body: string | null | undefined, id: string): boolean {
  return body?.trimEnd().split('\n').at(-1)?.trim() === markOf(id)
}

/** An issue an earlier try opened for this report without hearing back: every issue
 *  touched since the report came is asked for, and its body read for the report's mark. */
async function openedBefore(to: Github, report: Report): Promise<Issue | null> {
  const since = new Date(report.createdAt - 60_000).toISOString()
  for (let page = 1; page <= 5; page++) {
    const response = await asked(
      to,
      `/repos/${to.repo}/issues?state=all&labels=feedback&since=${since}&per_page=100&page=${String(page)}`,
    )
    if (!response.ok) throw new Error(`GitHub answered ${String(response.status)}`)
    const issues = await response.json<Issue[]>()
    const found = issues.find((one) => isMarked(one.body, report.id))
    if (found) return found
    if (issues.length < 100) return null
  }
  return null
}

async function opened(to: Github, report: Report): Promise<Issue> {
  const label = platformLabel(report.platform)
  const response = await asked(to, `/repos/${to.repo}/issues`, {
    method: 'POST',
    body: JSON.stringify({
      title: issueTitle(report.text),
      body: issueBody(report),
      labels: label ? ['feedback', label] : ['feedback'],
    }),
  })
  if (!response.ok) throw new Error(`GitHub answered ${String(response.status)}`)
  return await response.json<Issue>()
}

interface Row {
  id: string
  user_id: string | null
  text: string
  version: string
  platform: string
  log: string
  created_at: number
  issue_tries: number
  board_tries: number
  email: string | null
}

async function reportOf(env: Env, id: string): Promise<Row | null> {
  return await env.DB.prepare(
    `select f.id, f.user_id, f.text, f.version, f.platform, f.log, f.created_at,
            f.issue_tries, f.board_tries, u.email
       from feedback f left join users u on u.id = f.user_id
      where f.id = ?`,
  )
    .bind(id)
    .first<Row>()
}

/** Opens the issue for one report, where it has none and no other run has it in hand.
 *  Answers whether the report has its issue now. Never throws: a try that fails is
 *  written down and tried again later. */
export async function openIssue(env: Env, id: string, at = now()): Promise<boolean> {
  const to = github(env)
  if (!to) return false

  // Taken on first, so a request and the cron, or two runs of it, cannot both open one.
  const claimed = await env.DB.prepare(
    `update feedback set issue_claim = ?2
      where id = ?1 and issue_number is null and (issue_claim is null or issue_claim < ?3)`,
  )
    .bind(id, at, at - CLAIM)
    .run()
  if (!claimed.meta.changes) return false

  const row = await reportOf(env, id)
  if (!row) return false
  const report: Report = {
    id: row.id,
    text: row.text,
    version: row.version,
    platform: row.platform,
    log: row.log,
    createdAt: row.created_at,
    account: row.user_id
      ? { id: row.user_id, email: row.email ?? 'an account since deleted' }
      : null,
  }

  try {
    const issue =
      (row.issue_tries > 0 ? await openedBefore(to, report) : null) ?? (await opened(to, report))
    const written = await env.DB.prepare(
      `update feedback set issue_number = ?2, issue_url = ?3, issue_node = ?4, issue_claim = null
        where id = ?1`,
    )
      .bind(id, issue.number, issue.html_url, issue.node_id)
      .run()
    // The report went while GitHub was opening it: its account was deleted, and the
    // erase found no issue to withdraw yet. So this run withdraws the one it opened,
    // written down first, so one GitHub does not take now is withdrawn the next night.
    if (!written.meta.changes) {
      const what = `${ISSUES}${String(issue.number)}`
      await env.DB.prepare('insert or ignore into leftovers (what, since) values (?1, ?2)')
        .bind(what, at)
        .run()
      if ((await withdrawIssues(env, [issue.number])).length) {
        await env.DB.prepare('delete from leftovers where what = ?1').bind(what).run()
      }
      return false
    }
    await putOnBoard(env, id, issue.node_id, row.board_tries, at)
    return true
  } catch (error) {
    const tries = row.issue_tries + 1
    const wait = Math.min(LONGEST_WAIT, FIRST_WAIT * 2 ** Math.min(tries - 1, 20))
    console.warn(`feedback ${id}: no issue yet (${String(error)})`)
    await env.DB.prepare(
      `update feedback set issue_tries = ?2, issue_next_at = ?3, issue_claim = null where id = ?1`,
    )
      .bind(id, tries, at + wait)
      .run()
    return false
  }
}

/** The reports still waiting for their issue, tried again, and the issues still off the
 *  board: what the cron runs. */
export async function openWaitingIssues(env: Env, at = now()): Promise<void> {
  if (!github(env)) return
  const waiting = await env.DB.prepare(
    `select id from feedback
      where issue_number is null and issue_next_at <= ?1
        and (issue_claim is null or issue_claim < ?2)
      order by created_at limit ?3`,
  )
    .bind(at, at - CLAIM, AT_ONCE)
    .all<{ id: string }>()
  for (const { id } of waiting.results) await openIssue(env, id, at)

  if (!board(env)) return
  const off = await env.DB.prepare(
    `select id, issue_number, issue_node, board_tries from feedback
      where issue_number is not null and board_at is null and board_next_at <= ?1
      order by created_at limit ?2`,
  )
    .bind(at, AT_ONCE)
    .all<{ id: string; issue_number: number; issue_node: string | null; board_tries: number }>()
  for (const row of off.results) {
    const node = row.issue_node ?? (await nodeOf(env, row.issue_number))
    if (node) await putOnBoard(env, row.id, node, row.board_tries, at)
  }
}

/** The board's owner and number, from `FEEDBACK_PROJECT` (`user/number`), or null. */
function board(env: Env): { owner: string; number: number } | null {
  const named = /^([A-Za-z0-9-]+)\/(\d+)$/.exec(env.FEEDBACK_PROJECT?.trim() ?? '')
  return named?.[1] && named[2] ? { owner: named[1], number: Number(named[2]) } : null
}

/** An issue's node id, for one opened before the issue's node was kept (0065). */
async function nodeOf(env: Env, number: number): Promise<string | null> {
  const to = github(env)
  if (!to) return null
  try {
    const response = await asked(to, `/repos/${to.repo}/issues/${String(number)}`)
    if (!response.ok) return null
    return (await response.json<{ node_id?: string }>()).node_id ?? null
  } catch {
    return null
  }
}

async function graphql<T>(to: Github, query: string, variables: object): Promise<T> {
  const response = await asked(to, '/graphql', {
    method: 'POST',
    body: JSON.stringify({ query, variables }),
  })
  if (!response.ok) throw new Error(`GitHub answered ${String(response.status)}`)
  const answer = await response.json<{ data?: T; errors?: { message: string }[] }>()
  if (answer.errors?.length || !answer.data) {
    throw new Error(answer.errors?.map((one) => one.message).join('; ') ?? 'no answer')
  }
  return answer.data
}

interface Board {
  project: string
  status: string
  todo: string
}

/** The board's id, its Status field's and that field's Todo option's. */
async function boardOf(to: Github, owner: string, number: number): Promise<Board> {
  const data = await graphql<{
    user: {
      projectV2: {
        id: string
        field: { id: string; options: { id: string; name: string }[] } | null
      } | null
    } | null
  }>(
    to,
    `
      query ($owner: String!, $number: Int!) {
        user(login: $owner) {
          projectV2(number: $number) {
            id
            field(name: "Status") {
              ... on ProjectV2SingleSelectField {
                id
                options {
                  id
                  name
                }
              }
            }
          }
        }
      }
    `,
    { owner, number },
  )
  const project = data.user?.projectV2
  const todo = project?.field?.options.find((one) => one.name === 'Todo')
  if (!project?.field || !todo) throw new Error('the board has no Status with Todo')
  return { project: project.id, status: project.field.id, todo: todo.id }
}

/** Puts an issue on the board as Todo, and writes down that it is there. Never throws: a
 *  try that fails is written down and tried again from the cron. Putting it there twice
 *  is one item, so a try whose answer was lost does no harm. */
async function putOnBoard(
  env: Env,
  id: string,
  node: string,
  tries: number,
  at: number,
): Promise<void> {
  const to = github(env)
  const where = board(env)
  if (!to || !where) return
  try {
    const on = await boardOf(to, where.owner, where.number)
    const added = await graphql<{ addProjectV2ItemById: { item: { id: string } } }>(
      to,
      `
        mutation ($project: ID!, $content: ID!) {
          addProjectV2ItemById(input: { projectId: $project, contentId: $content }) {
            item {
              id
            }
          }
        }
      `,
      { project: on.project, content: node },
    )
    await graphql(
      to,
      `
        mutation ($project: ID!, $item: ID!, $field: ID!, $option: String!) {
          updateProjectV2ItemFieldValue(
            input: {
              projectId: $project
              itemId: $item
              fieldId: $field
              value: { singleSelectOptionId: $option }
            }
          ) {
            projectV2Item {
              id
            }
          }
        }
      `,
      {
        project: on.project,
        item: added.addProjectV2ItemById.item.id,
        field: on.status,
        option: on.todo,
      },
    )
    await env.DB.prepare('update feedback set board_at = ?2 where id = ?1').bind(id, at).run()
  } catch (error) {
    const wait = Math.min(LONGEST_WAIT, FIRST_WAIT * 2 ** Math.min(tries, 20))
    console.warn(`feedback ${id}: not on the board yet (${String(error)})`)
    await env.DB.prepare('update feedback set board_tries = ?2, board_next_at = ?3 where id = ?1')
      .bind(id, tries + 1, at + wait)
      .run()
  }
}

/** How an issue is named on the list of what a deleted account leaves behind (0038):
 *  `issues/<number>`. */
export const ISSUES = 'issues/'

/** What a withdrawn issue says instead of the report. */
const WITHDRAWN = {
  title: 'Feedback: withdrawn',
  body: 'The account this report came from was deleted, and the report with it.',
  state: 'closed',
  state_reason: 'not_planned',
}

/** The issues of reports whose account was deleted, closed and written over, by
 *  number. Answers the ones GitHub took; one it did not, or every one where no token is
 *  set, waits for the next try. One that is not there any more is as good as withdrawn. */
export async function withdrawIssues(env: Env, numbers: readonly number[]): Promise<number[]> {
  const to = github(env)
  if (!to) return []

  const done: number[] = []
  for (const number of numbers) {
    try {
      const response = await asked(to, `/repos/${to.repo}/issues/${String(number)}`, {
        method: 'PATCH',
        body: JSON.stringify(WITHDRAWN),
      })
      if (response.ok || response.status === 404 || response.status === 410) done.push(number)
      else console.warn(`issue ${String(number)}: not withdrawn yet (${String(response.status)})`)
    } catch (error) {
      console.warn(`issue ${String(number)}: not withdrawn yet (${String(error)})`)
    }
  }
  return done
}
