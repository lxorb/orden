import type { LocalKind } from '../providers'

export interface Said {
  program: string
  out: string
  code: number | null
  err: string
  timedOut: boolean
}

export interface Standing {
  state: 'missing' | 'out' | 'in' | 'unknown'
  program: string | null
  plan: string | null
  account: string | null
}

export function saidIn(value: unknown): Said | null {
  if (typeof value !== 'object' || value === null) return null
  const one = value as Record<string, unknown>
  if (typeof one.program !== 'string') return null
  return {
    program: one.program,
    out: typeof one.out === 'string' ? one.out : '',
    code: typeof one.code === 'number' ? one.code : null,
    err: typeof one.err === 'string' ? one.err : '',
    timedOut: one.timedOut === true,
  }
}

function titled(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

export function standingOf(kind: LocalKind, said: Said | null): Standing {
  if (!said) return { state: 'missing', program: null, plan: null, account: null }
  const base = { program: said.program, plan: null, account: null }
  if (said.timedOut) return { ...base, state: 'unknown' }

  return kind === 'claude-code' ? claudeStanding(said, base) : codexStanding(said, base)
}

function claudeStanding(said: Said, base: Omit<Standing, 'state'>): Standing {
  let status: Record<string, unknown> | null = null
  try {
    const value: unknown = JSON.parse(said.out)
    if (typeof value === 'object' && value !== null) status = value as Record<string, unknown>
  } catch {
    // An older Claude Code with no `auth status`: its exit code is all it said.
  }
  if (!status) return { ...base, state: said.code === 0 ? 'unknown' : 'out' }
  if (status.loggedIn !== true) return { ...base, state: 'out' }

  const subscription = typeof status.subscriptionType === 'string' ? status.subscriptionType : ''
  const method = typeof status.authMethod === 'string' ? status.authMethod : ''
  return {
    ...base,
    state: 'in',
    plan: subscription ? titled(subscription) : method && method !== 'claude.ai' ? 'API key' : null,
    account: typeof status.email === 'string' && status.email ? status.email : null,
  }
}

function codexStanding(said: Said, base: Omit<Standing, 'state'>): Standing {
  const words = `${said.out}\n${said.err}`
  if (/not logged in/i.test(words)) return { ...base, state: 'out' }
  if (/logged in using chatgpt/i.test(words)) return { ...base, state: 'in', plan: 'ChatGPT' }
  if (/logged in using an api key/i.test(words)) return { ...base, state: 'in', plan: 'API key' }
  return { ...base, state: said.code === 0 ? 'in' : 'out' }
}
