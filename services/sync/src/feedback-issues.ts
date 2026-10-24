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

/** The issue's title: the report's first sentence. */
export function issueTitle(text: string): string {
  const line = oneLine(text)
  const sentence = /^(.+?[.!?])(?:\s|$)/.exec(line)?.[1] ?? line
  const said = sentence.length > 80 ? `${sentence.slice(0, 79)}…` : sentence
  return `Feedback: ${said}`
}

/** The platform as a label: the system where the app is native, `web` in a browser. */
export function platformLabel(platform: string): string | null {
  const said = platform.toLowerCase()
  if (!said.trim()) return null
  if (said.startsWith('web')) return 'web'
  for (const system of ['macos', 'windows', 'linux', 'ios', 'android']) {
    if (said.includes(system)) return system
  }
  const build = said.split('·')[0]?.trim().slice(0, 40) ?? ''
  return build === '' ? null : build
}

/** Somebody's words, kept from pinging anybody on GitHub: a report saying `@lxorb`
 *  notifies nobody. An address is no mention - its at sign follows a letter - and is
 *  left as it is. */
function quiet(text: string): string {
  return text.replace(/(^|[^\w.])@(?=[A-Za-z0-9-])/g, '$1@\u200b')
}

/** A value for one cell of the table: one line, and no pipe to end the cell early. */
function cell(text: string): string {
  return quiet(oneLine(text)).replace(/\|/g, '\\|') || '-'
}

/** A fence the text inside it cannot close: longer than any run of backticks in it. */
function fenced(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((run) => run[0].length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}\n${text}\n${fence}`
}

/** The issue's body: the words, the table of what the app added, and the log folded
 *  away, cut from its start where the whole would be past GitHub's limit. */
export function issueBody(report: Report): string {
  const account = report.account
    ? `\`${report.account.id}\` · ${report.account.email}`
    : 'signed out'
  const head = `${quiet(report.text)}

| | |
| --- | --- |
| Version | ${cell(report.version || 'unknown')} |
| Platform | ${cell(report.platform || 'unknown')} |
| Account | ${cell(account)} |
| Report | \`${report.id}\` |
| Sent | ${new Date(report.createdAt).toISOString()} |

`
  const tail = `\n\n${markOf(report.id)}\n`
  if (!report.log) return `${head}No log came with it.${tail}`

  const open = '<details><summary>Recent app log</summary>\n\n'
  const close = '\n\n</details>'
  const room = MOST_BODY - SPARE - head.length - open.length - close.length - tail.length - 16
  let log = quiet(report.log)
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
  body?: string | null
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
    const found = issues.find((one) => one.body?.includes(markOf(report.id)))
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
  email: string | null
}

async function reportOf(env: Env, id: string): Promise<Row | null> {
  return await env.DB.prepare(
    `select f.id, f.user_id, f.text, f.version, f.platform, f.log, f.created_at,
            f.issue_tries, u.email
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
      'update feedback set issue_number = ?2, issue_url = ?3, issue_claim = null where id = ?1',
    )
      .bind(id, issue.number, issue.html_url)
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

/** The reports still waiting for their issue, tried again: what the cron runs. */
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
