export const ASK_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export type AskEffort = (typeof ASK_EFFORTS)[number]

export function isAskEffort(value: unknown): value is AskEffort {
  return typeof value === 'string' && (ASK_EFFORTS as readonly string[]).includes(value)
}
