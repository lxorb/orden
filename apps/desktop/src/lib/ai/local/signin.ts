import { invoke, platform } from '../../tauri'
import { waited } from '../../timing'
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

const STARTING = 20_000

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
  const [{ openTerminal }, { shells }, { ptyOf }, { workspace }] = await Promise.all([
    import('../../terminal/open'),
    import('../../terminal/shells.svelte'),
    import('../../terminal/running'),
    import('../../workspace.svelte'),
  ])

  const windows = platform() === 'windows'
  const list = await shells.ask()
  const shell = signingShell(list, shells.chosen, windows)
  if (!shell) return false

  await openTerminal(shell.id, { folder: null })
  const tab = workspace.activeTabId
  if (!tab) return false

  const line = `${loginLine(kind, program, windows, out, home)}\r`
  const started = Date.now()
  while (Date.now() - started < STARTING) {
    const pty = ptyOf(tab)
    const typed =
      pty !== undefined &&
      (await invoke('pty_write', { id: pty, data: line, binary: false }).then(
        () => true,
        () => false,
      ))
    if (typed) return true
    await waited(150)
  }
  return false
}
