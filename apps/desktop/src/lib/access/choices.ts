export type Choice = 'claude-code' | 'codex' | 'claude' | 'chatgpt' | 'other'

export function choices(local: boolean, account: boolean): Choice[] {
  const offered: Choice[] = [
    ...(local ? (['claude-code', 'codex'] as const) : []),
    ...(account ? (['claude', 'chatgpt'] as const) : []),
  ]
  return local || account ? [...offered, 'other'] : []
}

export function shownFirst(offered: readonly Choice[], last: string | null): Choice | null {
  return offered.find((one) => one === last) ?? offered[0] ?? null
}

export function viaAccount(choice: Choice): choice is 'claude' | 'chatgpt' {
  return choice === 'claude' || choice === 'chatgpt'
}
