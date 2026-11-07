import { now } from './crypto'
import { oneLine } from './email'
import type { Env } from './types'

const API = 'https://api.github.com'

export const MOST_BODY = 65_536

const SPARE = 512

const CLAIM = 5 * 60 * 1000

const FIRST_WAIT = 60 * 1000
const LONGEST_WAIT = 6 * 60 * 60 * 1000

const AT_ONCE = 10

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
  account: { id: string; email: string } | null
  images?: readonly string[]
}

export function issueTitle(text: string): string {
  const line = oneLine(text)
  const sentence = /^(.+?[.!?])(?:\s|$)/.exec(line)?.[1] ?? line
  const said = sentence.length > 80 ? `${sentence.slice(0, 79)}…` : sentence
  return `Feedback: ${said.replace(/@/g, '@\u200b')}`
}

const SYSTEMS = ['macos', 'windows', 'linux', 'ios', 'android'] as const

export function platformLabel(platform: string): string | null {
  const said = platform.toLowerCase()
  if (said.startsWith('web')) return 'web'
  return SYSTEMS.find((system) => said.includes(system)) ?? null
}

function longestTicks(text: string): number {
  return [...text.matchAll(/`+/g)]
    .map((run) => run[0].length)
    .reduce((high, one) => Math.max(high, one), 0)
}

function cell(text: string): string {
  const line = oneLine(text)
  if (!line) return '-'
  const ticks = '`'.repeat(longestTicks(line) + 1)
  const pad = line.startsWith('`') || line.endsWith('`') ? ' ' : ''
  return `${ticks}${pad}${line.replace(/\|/g, '\\|')}${pad}${ticks}`
}

function fenced(text: string): string {
  const fence = '`'.repeat(Math.max(2, longestTicks(text)) + 1)
  return `${fence}\n${text}\n${fence}`
}

function pictures(images: readonly string[] | undefined): string {
  if (!images?.length) return ''
  return `${images.map((url, at) => `![Image ${String(at + 1)}](${url})`).join('\n\n')}\n\n`
}

export function issueBody(report: Report): string {
  const account = report.account
    ? `\`${report.account.id}\` · ${cell(report.account.email)}`
    : 'signed out'
  const head = `${fenced(report.text)}

${pictures(report.images)}| | |
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
  node_id: string
  body?: string | null
}

function isMarked(body: string | null | undefined, id: string): boolean {
  return body?.trimEnd().split('\n').at(-1)?.trim() === markOf(id)
}

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

export async function imagesOf(env: Env, id: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    'select name from feedback_images where feedback_id = ? order by position',
  )
    .bind(id)
    .all<{ name: string }>()
  return results.map((one) => imageUrl(env, one.name))
}

function imageUrl(env: Env, name: string): string {
  return `${env.APP_ORIGIN}/v1/feedback/images/${name}`
}

export type IssueState = 'open' | 'done' | 'not planned'

export async function issueState(env: Env, number: number): Promise<IssueState | null> {
  const to = github(env)
  if (!to) return null
  try {
    const response = await asked(to, `/repos/${to.repo}/issues/${String(number)}`)
    if (!response.ok) return null
    const issue = await response.json<{ state?: string; state_reason?: string | null }>()
    if (issue.state === 'open') return 'open'
    return issue.state_reason === 'not_planned' ? 'not planned' : 'done'
  } catch {
    return null
  }
}

export async function openIssue(env: Env, id: string, at = now()): Promise<boolean> {
  const to = github(env)
  if (!to) return false

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
    images: await imagesOf(env, row.id),
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

function board(env: Env): { owner: string; number: number } | null {
  const named = /^([A-Za-z0-9-]+)\/(\d+)$/.exec(env.FEEDBACK_PROJECT?.trim() ?? '')
  return named?.[1] && named[2] ? { owner: named[1], number: Number(named[2]) } : null
}

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

export const ISSUES = 'issues/'

const WITHDRAWN = {
  title: 'Feedback: withdrawn',
  body: 'The account this report came from was deleted, and the report with it.',
  state: 'closed',
  state_reason: 'not_planned',
}

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
