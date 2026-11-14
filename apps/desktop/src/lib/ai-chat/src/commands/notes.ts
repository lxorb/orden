import { frontMatterList, frontMatterValue, stripFrontMatter } from '@orden/markdown/front-matter'
import { isEffort } from '../chat/effort'
import type { Effort } from '../../../ai-providers/src/api'
import { type Mode, modeIn } from '../../../ai-providers/src/api'

export type NoteKind = 'command' | 'agent' | 'output-style'

export const NOTE_KEYS: readonly NoteKind[] = ['command', 'agent', 'output-style']

export interface NoteCommand {
  kind: NoteKind
  name: string
  path: string
  body: string
  description?: string
  model?: string
  effort?: Effort
  mode?: Mode
  arguments: string[]
  tools: string[]
}

function withMode(mode: Mode | null): { mode?: Mode } {
  return mode ? { mode } : {}
}

export function commandName(value: string): string {
  return value
    .trim()
    .replace(/^\/+/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
}

export function rolesOf(path: string, text: string): NoteCommand[] {
  const body = stripFrontMatter(text).trim()
  const value = (name: string) => frontMatterValue(text, name) ?? undefined
  const effort = value('effort')?.toLowerCase()
  const mode = value('mode')?.toLowerCase()
  const description = value('description')
  const model = value('model')
  const shared = {
    path,
    body,
    ...(description ? { description } : {}),
    ...(model ? { model } : {}),
    ...(isEffort(effort) ? { effort } : effort === 'extra' ? { effort: 'xhigh' as const } : {}),
    ...withMode(modeIn(mode)),
    arguments: frontMatterList(text, 'arguments').map(commandName).filter(Boolean),
    tools: frontMatterList(text, 'tools'),
  }
  return NOTE_KEYS.flatMap((kind) => {
    const name = commandName(frontMatterValue(text, kind) ?? '')
    return name ? [{ kind, name, ...shared }] : []
  })
}

export function splitArgs(args: string): string[] {
  const out: string[] = []
  for (const found of args.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    out.push(found[1] ?? found[2] ?? found[3] ?? '')
  }
  return out
}

export function expand(command: Pick<NoteCommand, 'body' | 'arguments'>, args: string): string {
  const words = splitArgs(args)
  const used = { any: false }
  const ask = (value: string) => {
    used.any = true
    return value
  }
  let text = command.body
    .replace(/\$ARGUMENTS\[(\d+)\]/g, (_whole, at: string) => ask(words[Number(at)] ?? ''))
    .replace(/\$ARGUMENTS\b/g, () => ask(args.trim()))
    .replace(/\$(\d)\b/g, (_whole, at: string) => ask(words[Number(at) - 1] ?? ''))
  command.arguments.forEach((name, at) => {
    const pattern = new RegExp(`\\$${name.replace(/[-]/g, '\\-')}(?![\\w-])`, 'g')
    text = text.replace(pattern, () => ask(words[at] ?? ''))
  })
  if (!used.any && args.trim()) text = `${text}\n\n${args.trim()}`
  return text
}
