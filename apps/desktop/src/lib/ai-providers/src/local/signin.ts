import { portOf } from '@orden/contracts'
import { platform } from '../../../platform/src/api'
import type { LocalKind } from '../providers'

const LOGIN: Record<LocalKind, string> = {
  'claude-code': 'auth login',
  codex: 'login',
  'gemini-cli': '',
}
const LOGOUT: Record<LocalKind, string> = {
  'claude-code': 'auth logout',
  codex: 'logout',
  'gemini-cli': '',
}

const HOME_VARIABLE: Record<LocalKind, string> = {
  'claude-code': 'CLAUDE_CONFIG_DIR',
  codex: 'CODEX_HOME',
  'gemini-cli': 'GEMINI_CLI_HOME',
}

const posix = (word: string) => `'${word.replace(/'/g, `'\\''`)}'`

export function loginLine(
  kind: LocalKind,
  program: string,
  windows: boolean,
  out = false,
  home: string | null = null,
): string {
  const quoted = windows ? `"${program}"` : posix(program)
  const line = [quoted, (out ? LOGOUT : LOGIN)[kind]].filter(Boolean).join(' ')
  if (!home) return line
  return windows
    ? `set "${HOME_VARIABLE[kind]}=${home}" && ${line}`
    : `${HOME_VARIABLE[kind]}=${posix(home)} ${line}`
}

const SAYS_POSIX = /^(?:ba|z|da|k|mk)?sh$|^fish$/

export function signingShell<T extends { id: string }>(
  list: readonly T[],
  chosen: T | undefined,
  windows: boolean,
): T | undefined {
  if (windows) return list.find((one) => one.id === 'cmd') ?? chosen
  const posix = (one: T) => SAYS_POSIX.test(one.id.split('/').pop() ?? '')
  return chosen && posix(chosen) ? chosen : (list.find(posix) ?? chosen)
}

export async function signIn(
  kind: LocalKind,
  program: string,
  home: string | null = null,
): Promise<boolean> {
  return await typeInTerminal(kind, program, false, home)
}

export async function signOut(
  kind: LocalKind,
  program: string,
  home: string | null = null,
): Promise<boolean> {
  return await typeInTerminal(kind, program, true, home)
}

async function typeInTerminal(
  kind: LocalKind,
  program: string,
  out: boolean,
  home: string | null,
): Promise<boolean> {
  const terminal = portOf('terminal.lines')
  if (!terminal.ok) return false

  const windows = platform() === 'windows'
  return await terminal.value.typeIn(
    `${loginLine(kind, program, windows, out, home)}\r`,
    (list, chosen) => signingShell(list, chosen, windows),
  )
}
