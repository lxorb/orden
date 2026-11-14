import { when } from '../../../when'
import type { Heard, Limit } from './heard'

export interface Ending {
  code: number | null
  timedOut: boolean
  stopped: boolean
  err: string
}

export function limitSentence(plan: string, limit: Limit): string {
  if (limit.until !== null) {
    return `Your ${plan} plan is at its limit until ${when(limit.until, 'medium')}.`
  }
  if (limit.untilWords) {
    return `Your ${plan} plan is at its limit until ${limit.untilWords}.`
  }
  return `Your ${plan} plan is at its limit for now.`
}

export function troubleOf(
  name: string,
  plan: string,
  heard: Heard,
  ended: Ending,
  answered: boolean,
): string | null {
  if (heard.limit?.state === 'reached') return limitSentence(plan, heard.limit)
  if (heard.signedOut) return `Sign in to ${name} first.`
  if (ended.timedOut) return `${name} took too long to answer.`
  if (heard.trouble) return heard.trouble
  if (ended.code === 0 || (ended.code === null && answered)) return null

  if (/unknown option|unexpected argument|unrecognized/i.test(ended.err)) {
    return `${name} is out of date. Update it and try again.`
  }
  const last = ended.err
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
  return last ?? (answered ? null : 'The model did not answer.')
}
