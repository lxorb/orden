const CONTINUE: Readonly<Record<string, string>> = {
  claude: 'claude --continue',
  codex: 'codex resume --last',
}

export function resumeCommand(program: string | null): string | null {
  if (!program) return null
  return CONTINUE[program.toLowerCase()] ?? null
}
