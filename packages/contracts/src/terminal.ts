export interface TerminalShell {
  readonly id: string
}

export interface TerminalLinesPort {
  readonly typeIn: (
    line: string,
    pick: (
      shells: readonly TerminalShell[],
      chosen: TerminalShell | undefined,
    ) => TerminalShell | undefined,
  ) => Promise<boolean>
}

export interface TerminalPorts {
  readonly 'terminal.lines': TerminalLinesPort
}
