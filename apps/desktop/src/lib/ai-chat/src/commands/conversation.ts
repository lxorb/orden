import { copyText } from '../../../ui-controls/src/api'
import { workspace } from '../../../workspace.svelte'
import type { AutoCompact, Thread, Turn } from '../../../ai-providers/src/api'
import { compactsAt } from '../chat/usage'
import { tokens } from './account'
import { shown } from './evaluate'
import type { Host } from './host'
import { tasks, type TaskKind } from './tasks.svelte'

const RECAP =
  'Say in one line of at most eight words what this conversation is about. Answer with the line alone, in the language of the conversation, without quotation marks.'

export async function recap(host: Host, thread: Thread): Promise<string> {
  const said = await host.ask(thread, [
    { role: 'system', content: RECAP },
    { role: 'user', content: shown(thread) || thread.title },
  ])
  return (
    said
      .trim()
      .split('\n')[0]
      ?.replace(/^["“'`]+|["”'`.]+$/g, '')
      .slice(0, 80) ?? ''
  )
}

function wordsOf(turn: Turn): string {
  return turn.parts.flatMap((part) => (part.kind === 'text' ? [part.text] : [])).join('')
}

export function nthAnswer(thread: Pick<Thread, 'turns'>, n: number): string {
  const answers = thread.turns.filter((turn) => turn.role === 'model' && wordsOf(turn).trim())
  const turn = answers[answers.length - Math.max(1, n)]
  return turn ? wordsOf(turn).trim() : ''
}

export async function copy(thread: Thread, args: string): Promise<boolean> {
  const words = nthAnswer(thread, Number.parseInt(args, 10) || 1)
  if (words) await copyText(words)
  return !!words
}

export function markdownOf(thread: Pick<Thread, 'title' | 'turns'>, title = thread.title): string {
  const body = thread.turns.flatMap((turn) => {
    if (turn.role === 'you') {
      const text = turn.draft?.text.trim()
      return text ? [text.replace(/^/gm, '> ')] : []
    }
    const words = wordsOf(turn).trim()
    return words ? [words] : []
  })
  return [title ? `# ${title}` : '', ...body].filter(Boolean).join('\n\n') + '\n'
}

export async function exportThread(host: Host, thread: Thread, name: string): Promise<void> {
  const named = name.trim()
  if (!named) {
    await copyText(markdownOf(thread))
    return
  }
  const root = workspace.spaces.find((one) => one.id === thread.space)?.root
  const path = root ? await workspace.noteFrom(markdownOf(thread, named), root) : null
  if (path) await workspace.open(path)
  else {
    const why = root ? 'you can only read this space' : 'no such space'
    host.line(thread, `Save as a note: ${why}`)
  }
}

export function autocompactIn(args: string): AutoCompact | null {
  const word = args.trim().toLowerCase()
  if (word === 'auto' || word === 'off') return word
  const found = /^(\d+(?:\.\d+)?)\s*([km]?)$/.exec(word)
  if (!found) return null
  const scale = found[2] === 'm' ? 1_000_000 : found[2] === 'k' ? 1_000 : 1
  return Math.round(Number(found[1]) * scale)
}

export function autocompact(host: Host, thread: Thread, args: string): void {
  const asked = autocompactIn(args)
  if (asked !== null) {
    thread.autocompact = asked
    host.touched(thread)
  }
  const at = compactsAt(thread.usage.window, thread.autocompact ?? 'auto')
  host.line(thread, `◔ ${thread.autocompact ?? 'auto'}${at ? `, ${tokens(at)}` : ''}`)
}

const GLYPH: Record<TaskKind, string> = {
  goal: '◎',
  loop: '↻',
  subtask: '↳',
  batch: '☰',
  research: '⌕',
  fork: '⑂',
}

export function listJobs(host: Host, thread: Thread): void {
  const now = Date.now()
  const rows = tasks.of(thread.id).map((one) => {
    const minutes = Math.round((now - one.started) / 60_000)
    return `${GLYPH[one.kind]} ${one.label.split('\n')[0]?.slice(0, 80) ?? ''}, ${minutes}m`
  })
  host.line(thread, rows.join('\n') || '∅')
}
