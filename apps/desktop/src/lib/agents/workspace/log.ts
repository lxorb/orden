import type { AgentAnswer } from '../../automation/caller'
import { notePath } from '../../space-paths'
import { invoke } from '../../tauri'
import { notes } from '../docs'
import { asked } from './asks'
import { type Call, done, maybe, need, writerOf } from './call'
import { made, madeOrChanged } from './notes'
import { Refused } from './problem'
import { judgedForWriting, onDisk, placeOf, writableAt } from './spaces'

interface Line {
  at: number
  agent: string
  verb: string
  tab?: string
  args: Record<string, unknown>
  status: string
  code?: unknown
}

function isLine(value: unknown): value is Line {
  const line = value as Partial<Line> | null
  return (
    typeof line === 'object' &&
    line !== null &&
    typeof line.at === 'number' &&
    typeof line.agent === 'string' &&
    typeof line.verb === 'string' &&
    typeof line.status === 'string'
  )
}

const MOST_LINES = 500

function aboutOf(line: Line): string {
  const said = (key: string) => {
    const value = line.args[key]
    return typeof value === 'string' && value.trim() ? value.trim() : null
  }

  const path = said('path') ?? said('note')
  if (path !== null) return `[[${path.replace(/\.md$/i, '')}]]`

  const url = said('url')
  if (url !== null && /^https?:\/\//i.test(url)) return `<${url}>`

  const query = said('query')
  if (query !== null) return `"${query.replace(/"/g, "'").slice(0, 80)}"`

  return line.tab === undefined ? '' : `tab ${line.tab}`
}

function lineOf(line: Line): string {
  const when = new Date(line.at).toISOString().slice(11, 19)
  const about = aboutOf(line)
  const code = typeof line.code === 'string' ? ` (${line.code})` : ''
  const how = line.status === 'ok' ? '' : ` - ${line.status}${code}`
  return `- ${when} \`${line.verb}\`${about ? ` ${about}` : ''}${how}`
}

export async function attachAgentLog(call: Call): Promise<AgentAnswer> {
  const agent = call.caller.agent?.id ?? 'cli'
  const day = maybe(call, 'session') ?? new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Refused('bad_arguments', 'session is a day, like 2026-09-30')
  }

  const place = placeOf(call)
  const named = judgedForWriting(need(call, 'note'))
  const relative = notePath(named)
  if (relative === null) throw new Refused('bad_arguments', `${named} is not a markdown note`)
  writableAt(place, onDisk(place, relative))

  const read: unknown[] = await invoke<unknown[]>('agents_log', { day }).catch(() => [])
  const lines = read.filter(isLine).filter((one) => one.agent === agent)
  if (!lines.length) {
    throw new Refused('not_found', `there is nothing of this agent's in the log of ${day}`)
  }

  const shown = lines.slice(-MOST_LINES)
  const name = call.caller.agent?.name ?? 'nib'
  const section = `## ${name}, ${day}\n\n${shown.map(lineOf).join('\n')}`

  const question = await asked(call, null, `Write the log of ${day} into ${relative}`)
  if (question) return question

  await madeOrChanged(
    place,
    relative,
    () => made(place, relative, `${section}\n`, null),
    () =>
      notes.editNote(writerOf(call), { path: relative, space: place.space.id }, [
        { at: { end: true }, insert_after: section },
      ]),
  )

  return done({ path: relative, calls: shown.length })
}
