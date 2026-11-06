import { key } from '../i18n.svelte'

export type Mode = 'approve' | 'auto' | 'full' | 'plan'

export const MODES: readonly Mode[] = ['approve', 'auto', 'full', 'plan']

const CYCLE: readonly Mode[] = ['approve', 'auto', 'plan']

export const FIRST_MODE: Mode = 'approve'

const WORDS: Record<Mode, string> = {
  approve: key('Approve'),
  auto: key('Auto'),
  full: key('Full permissions'),
  plan: key('Plan'),
}

export function modeWord(mode: Mode): string {
  return WORDS[mode]
}

export function modeIn(value: unknown): Mode | null {
  if (value === 'ask') return 'approve'
  if (value === 'agent') return 'full'
  return MODES.find((one) => one === value) ?? null
}

export function nextMode(mode: Mode): Mode {
  if (mode === 'full') return 'plan'
  return CYCLE[(CYCLE.indexOf(mode) + 1) % CYCLE.length] ?? FIRST_MODE
}

const HOLDS: Record<Mode, readonly Mode[]> = {
  approve: ['approve'],
  plan: ['plan'],
  auto: ['auto', 'approve', 'plan'],
  full: MODES,
}

export function noMoreThan(asked: Mode, held: Mode): Mode | null {
  return HOLDS[held].includes(asked) ? asked : null
}

export function actsAlone(mode: Mode): boolean {
  return mode === 'auto' || mode === 'full'
}

export function modeOfGrant(supervision: 'unsupervised' | 'confirm' | 'autonomous'): Mode {
  if (supervision === 'confirm') return 'approve'
  return supervision === 'autonomous' ? 'full' : 'auto'
}
