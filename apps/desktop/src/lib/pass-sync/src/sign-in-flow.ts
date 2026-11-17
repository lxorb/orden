import type { FormKind } from './channel'

export const FLOW_WINDOW = 2 * 60_000

const SIGN_IN_KINDS = ['login', 'username', 'password', 'totp'] as const
export type SignInKind = (typeof SIGN_IN_KINDS)[number]

export interface Step {
  page: string
  kind: SignInKind
}

export interface Flow {
  item: string
  started: number
  steps: Step[]
  ended: boolean
}

export type Go = 'start' | 'continue' | 'stop' | 'none'

const NEXT: Record<SignInKind, readonly SignInKind[]> = {
  username: ['password', 'totp'],
  password: ['totp'],
  login: ['totp'],
  totp: [],
}

const STARTS: readonly SignInKind[] = ['login', 'username', 'password']

export function isSignInKind(kind: FormKind): kind is SignInKind {
  return (SIGN_IN_KINDS as readonly FormKind[]).includes(kind)
}

export function pageOf(url: string): string {
  try {
    const page = new URL(url)
    return page.origin + page.pathname
  } catch {
    return url
  }
}

function follows(flow: Flow, step: Step): boolean {
  const last = flow.steps.at(-1)
  return last !== undefined && NEXT[last.kind].includes(step.kind)
}

function repeated(flow: Flow, step: Step): boolean {
  return flow.steps.some((one) => one.page === step.page && one.kind === step.kind)
}

export function flowGoes(flow: Flow | null, step: Step, now: number): Go {
  const begins = STARTS.includes(step.kind) ? 'start' : 'none'
  if (flow === null) return begins
  const within = now - flow.started <= FLOW_WINDOW
  if (within && !flow.ended) {
    if (repeated(flow, step) || !follows(flow, step)) return 'stop'
    return 'continue'
  }
  if (within) return 'none'
  if (now - flow.started <= 2 * FLOW_WINDOW && follows(flow, step) && !repeated(flow, step)) {
    return flow.ended ? 'none' : 'stop'
  }
  return begins
}
