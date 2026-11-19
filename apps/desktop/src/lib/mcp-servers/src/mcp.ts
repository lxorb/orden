import { invoke } from '../../platform/src/api'

export type Permission = 'allow' | 'ask' | 'off'
export type Transport =
  | { kind: 'stdio'; command: string; args: string[]; cwd?: string | null; env: string[] }
  | { kind: 'http'; url: string; headers: string[] }
export interface Server {
  id: string
  name: string
  on: boolean
  transport: Transport
  tools: Record<string, Permission>
  from?: string | null
}
export interface ToolInfo {
  name: string
  title?: string | null
  description: string
  inputSchema: unknown
  readOnly: boolean
  permission: Permission
}
export type State = 'off' | 'starting' | 'ready' | 'failed'
export interface ServerView extends Server {
  state: State
  error?: string | null
  listed: ToolInfo[]
  secretsSet: string[]
}
export interface Secrets {
  env: Record<string, string>
  headers: Record<string, string>
}
export interface FoundServer {
  name: string
  transport: Transport
  already: boolean
  orden: boolean
  needsInput: string[]
}
export interface Found {
  source: string
  sourceName: string
  path: string
  servers: FoundServer[]
}
export interface Pick {
  source: string
  name: string
}

export const PERMISSIONS: { value: Permission; label: string }[] = [
  { value: 'allow', label: 'Allow' },
  { value: 'ask', label: 'Ask' },
  { value: 'off', label: 'Off' },
]
const STATES: Record<State, string> = { off: 'Off', starting: 'Starting', ready: 'Connected', failed: 'Failed' }
export function stateWords(view: ServerView): string {
  if (view.state !== 'ready') return STATES[view.state]
  const count = view.listed.length
  return `Connected, ${count} ${count === 1 ? 'tool' : 'tools'}`
}
function words(line: string): string[] {
  const found: string[] = []
  let word: string | null = null
  let quote: string | null = null
  for (const char of line) {
    if (quote) {
      if (char === quote) quote = null
      else word = (word ?? '') + char
    } else if (char === '"' || char === "'") {
      quote = char
      word ??= ''
    } else if (/\s/.test(char)) {
      if (word !== null) found.push(word)
      word = null
    } else word = (word ?? '') + char
  }
  if (word !== null) found.push(word)
  return found
}
const line = (args: readonly string[]): string =>
  args.map((one) => (one === '' || /[\s"']/.test(one) ? (one.includes('"') ? `'${one}'` : `"${one}"`) : one)).join(' ')
export const commandLine = (transport: Transport): string =>
  transport.kind === 'http' ? transport.url : line([transport.command, ...transport.args])

interface Row {
  name: string
  value: string
  saved: boolean
}
interface Draft {
  kind: 'stdio' | 'http'
  name: string
  command: string
  args: string
  cwd: string
  url: string
  rows: Row[]
}
export function draftOf(view: ServerView | null): Draft {
  const transport = view?.transport
  const names = transport ? (transport.kind === 'stdio' ? transport.env : transport.headers) : []
  return {
    kind: transport?.kind ?? 'stdio',
    name: view?.name ?? '',
    command: transport?.kind === 'stdio' ? transport.command : '',
    args: transport?.kind === 'stdio' ? line(transport.args) : '',
    cwd: transport?.kind === 'stdio' ? (transport.cwd ?? '') : '',
    url: transport?.kind === 'http' ? transport.url : '',
    rows: names.map((name) => ({ name, value: '', saved: !!view?.secretsSet.includes(name) })),
  }
}
type Made = { server: Server; secrets: Secrets | null } | { problem: string }
export function madeOf(draft: Draft, view: ServerView | null): Made {
  const name = draft.name.trim()
  if (!name) return { problem: 'Give the server a name' }
  const rows = draft.rows.map((one) => ({ ...one, name: one.name.trim() })).filter((one) => one.name)
  const names = [...new Set(rows.map((one) => one.name))]
  let transport: Transport
  if (draft.kind === 'stdio') {
    const command = draft.command.trim()
    if (!command) return { problem: 'Type the command that starts the server' }
    const cwd = draft.cwd.trim()
    transport = { kind: 'stdio', command, args: words(draft.args), cwd: cwd || null, env: names }
  } else {
    const url = draft.url.trim()
    if (!/^https?:\/\/\S+$/i.test(url)) return { problem: 'Type a URL that starts with http:// or https://' }
    transport = { kind: 'http', url, headers: names }
  }
  const typed = Object.fromEntries(rows.filter((one) => one.value !== '').map((one) => [one.name, one.value]))
  const secrets = Object.keys(typed).length
    ? draft.kind === 'stdio'
      ? { env: typed, headers: {} }
      : { env: {}, headers: typed }
    : null
  return {
    server: {
      id: view?.id ?? '',
      name,
      on: view?.on ?? true,
      transport,
      tools: { ...(view?.tools ?? {}) },
      from: view?.from ?? null,
    },
    secrets,
  }
}
export function importable(found: readonly Found[]): Found[] {
  const kept = found
    .map((one) => ({ ...one, servers: one.servers.filter((server) => !server.orden) }))
    .filter((one) => one.servers.length > 0)
  return kept.some((one) => one.servers.some((server) => !server.already)) ? kept : []
}
export const scanMcp = async (): Promise<Found[]> => importable(await invoke<Found[]>('mcp_import_scan'))
export const said = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : String(error)
