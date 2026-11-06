import { nameOf } from '../space-paths'

const BETWEEN = ' · '

const TITLE_MOST = 120

const DECORATION = /^[^\p{L}\p{N}"'([{<]+/u

const CONSOLE_TITLE = /^(?:administrator:\s*)?[a-z]:\\.*\.(?:exe|com|bat|cmd)\b/i

export function programTitle(raw: string): string | null {
  const plain = raw.replace(/\p{Cc}/gu, '').trim()
  if (CONSOLE_TITLE.test(plain)) return null

  const words = plain.replace(DECORATION, '').trim() || plain
  if (!words) return null
  return words.length > TITLE_MOST ? `${words.slice(0, TITLE_MOST - 1)}…` : words
}

export function folderName(folder: string | null): string | null {
  if (!folder) return null

  const trimmed = folder.replace(/[\\/]+$/, '')
  if (!trimmed) return '/'
  if (/^[A-Za-z]:$/.test(trimmed)) return trimmed
  return nameOf(trimmed) || trimmed
}

export function terminalName(parts: {
  given: string | null
  title: string | null
  program: string | null
  shell: string
  folder: string | null
}): string {
  if (parts.given) return parts.given
  if (parts.title) return parts.title

  const what = parts.program ?? parts.shell
  const where = folderName(parts.folder)
  return where ? `${what}${BETWEEN}${where}` : what
}

export class Front {
  program: string | null = null
  title: string | null = null
  private prompting = true
  private waiting: string | null = null

  constructor(private readonly blind: boolean) {}

  entered() {
    this.prompting = false
  }

  prompted() {
    this.prompting = true
    this.program = null
    this.title = null
    this.waiting = null
  }

  titled(raw: string): boolean {
    const title = programTitle(raw)
    if (!raw.trim()) {
      this.title = null
      this.waiting = null
      return false
    }
    if (title === null || this.prompting) return false

    if (this.program !== null || this.blind) {
      this.title = title
      return false
    }
    this.waiting = title
    return true
  }

  looked(program: string | null) {
    if (program !== this.program) this.title = null
    this.program = program
    if (program !== null && this.waiting !== null) this.title = this.waiting
    this.waiting = null
  }

  told(program: string | null, title: string | null) {
    this.program = program
    this.title = title === null ? null : programTitle(title)
    this.waiting = null
  }

  get worthLooking(): boolean {
    return !this.blind && !this.prompting && (this.program !== null || this.waiting !== null)
  }
}

export type TerminalMark =
  | 'claude'
  | 'codex'
  | 'node'
  | 'python'
  | 'git'
  | 'ssh'
  | 'docker'
  | 'vim'
  | 'powershell'
  | 'cmd'
  | 'shell'

const PROGRAMS: readonly [RegExp, TerminalMark][] = [
  [/^claude$/, 'claude'],
  [/^codex$/, 'codex'],
  [/^node(js)?$/, 'node'],
  [/^(python(\d+(\.\d+)?)?w?|py|pyw|ipython\d*)$/, 'python'],
  [/^git$/, 'git'],
  [/^(ssh|mosh|mosh-client)$/, 'ssh'],
  [/^(docker|docker-compose|podman)$/, 'docker'],
  [/^(vim?|nvim|gvim|vimx)$/, 'vim'],
]

export function programMark(program: string | null): TerminalMark | null {
  if (!program) return null
  const name = program.toLowerCase()
  return PROGRAMS.find(([pattern]) => pattern.test(name))?.[1] ?? null
}

export function shellMark(shell: string): TerminalMark {
  if (shell.startsWith('ssh:')) return 'ssh'
  if (/^(pwsh|powershell|vs-pwsh:)/.test(shell)) return 'powershell'
  if (/^(cmd|vs-cmd:)/.test(shell)) return 'cmd'
  return 'shell'
}

export function terminalMark(shell: string, program: string | null): TerminalMark {
  return programMark(program) ?? shellMark(shell)
}
