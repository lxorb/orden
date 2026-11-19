import type { TabMenuEntry } from './tab-kinds'

export interface TerminalShell {
  readonly id: string
}
export interface TerminalLinesPort {
  readonly typeIn: (
    line: string,
    pick: (shells: readonly TerminalShell[], chosen: TerminalShell | undefined) => TerminalShell | undefined,
  ) => Promise<boolean>
}
interface TerminalMakingPort {
  readonly open: (shell?: string) => Promise<void>
  readonly shells: (open: (shell: string) => void) => Promise<TabMenuEntry[]>
  readonly warm: () => Promise<void>
  readonly pickHost: (pane?: string) => Promise<void>
  readonly online: () => Promise<void>
}
interface TerminalJudgePort {
  readonly runsFree: (
    program: string,
    args: readonly string[],
    programs: readonly string[],
    folder: string,
  ) => Promise<boolean>
}
export interface TerminalPorts {
  readonly 'terminal.judge': TerminalJudgePort
  readonly 'terminal.lines': TerminalLinesPort
  readonly 'terminal.making': TerminalMakingPort
}
