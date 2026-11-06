import { i18n } from '../../i18n.svelte'
import { nameOf } from '../../space-paths'
import { wordFor } from './words'

export interface Call {
  seq: number
  at: number
  agent: string
  verb: string
  tab: string | null
  url: string | null
  path: string | null
  status: 'ok' | 'needs_approval' | 'error'
}

const KEPT = 200

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

export function readCall(line: unknown, seq = 0): Call | null {
  if (!isRecord(line)) return null

  const { at, agent, verb, tab, args, status } = line
  if (typeof at !== 'number' || typeof agent !== 'string' || typeof verb !== 'string') return null
  if (status !== 'ok' && status !== 'needs_approval' && status !== 'error') return null
  if (wordFor(verb) === null) return null

  const named = isRecord(args) ? args : {}
  const url = text(named.url)

  return {
    seq,
    at,
    agent,
    verb,
    tab: text(tab),
    url: url !== null && /^https?:\/\//i.test(url) ? url : null,
    path: text(named.path),
    status,
  }
}

export function callsOf(lines: readonly unknown[], agent: string): Call[] {
  const calls: Call[] = []

  for (let at = lines.length - 1; at >= 0 && calls.length < KEPT; at--) {
    const call = readCall(lines[at], at)
    if (call?.agent === agent) calls.push(call)
  }

  return calls
}

export function today(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10)
}

export function aboutOf(call: Call, titleOf: (tab: string) => string | null): string | null {
  if (call.path !== null) return nameOf(call.path).replace(/\.md$/i, '')
  if (call.url !== null) return hostOf(call.url)
  return call.tab === null ? null : titleOf(call.tab)
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

export function sessionMarkdown(name: string, calls: readonly Call[]): string {
  const ordered = [...calls].reverse()
  const first = ordered[0]
  const day = first ? i18n.when(first.at, { day: 'numeric', month: 'long', year: 'numeric' }) : ''
  const lines = ordered.map((call) => {
    const time = i18n.when(call.at, { hour: '2-digit', minute: '2-digit' })
    const word = wordFor(call.verb) ?? call.verb
    const link =
      call.path !== null
        ? ` [[${call.path.replace(/\.md$/i, '')}]]`
        : call.url !== null
          ? ` [${hostOf(call.url)}](${call.url})`
          : ''
    const mark = call.status === 'error' ? ' ✗' : call.status === 'needs_approval' ? ' ?' : ''
    return `- ${time} ${word}${link}${mark}`
  })

  return `## ${name}, ${day}\n\n${lines.join('\n')}\n`
}
