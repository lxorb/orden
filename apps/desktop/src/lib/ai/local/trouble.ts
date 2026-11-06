import { t } from '../../i18n.svelte'
import { when } from '../../when'
import type { Heard, Limit } from './heard'

export interface Ending {
  code: number | null
  timedOut: boolean
  stopped: boolean
  err: string
}

export function limitSentence(plan: string, limit: Limit): string {
  if (limit.until !== null) {
    return t('Your {plan} plan is at its limit until {time}.', {
      plan,
      time: when(limit.until, 'medium'),
    })
  }
  if (limit.untilWords) {
    return t('Your {plan} plan is at its limit until {time}.', { plan, time: limit.untilWords })
  }
  return t('Your {plan} plan is at its limit for now.', { plan })
}

export function troubleOf(
  name: string,
  plan: string,
  heard: Heard,
  ended: Ending,
  answered: boolean,
): string | null {
  if (heard.limit?.state === 'reached') return limitSentence(plan, heard.limit)
  if (heard.signedOut) return t('Sign in to {name} first.', { name })
  if (ended.timedOut) return t('{name} took too long to answer.', { name })
  if (heard.trouble) return heard.trouble
  if (ended.code === 0 || (ended.code === null && answered)) return null

  if (/unknown option|unexpected argument|unrecognized/i.test(ended.err)) {
    return t('{name} is out of date. Update it and try again.', { name })
  }
  const last = ended.err
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
  return last ?? (answered ? null : t('The model did not answer.'))
}
