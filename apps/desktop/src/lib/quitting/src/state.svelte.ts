import type { Stopping } from '@orden/contracts'
import { keep, storedText } from '../../platform/src/api'
import type { Why } from './rows'

const WARN_KEY = 'orden:terminal-quit-warn'

const WARNINGS = ['always', 'running', 'never'] as const

export type Warning = (typeof WARNINGS)[number]

export function asWarning(value: unknown): Warning {
  return WARNINGS.find((one) => one === value) ?? 'running'
}

type Answer = 'go' | 'stay' | Stopping

class QuitAsk {
  warning = $state<Warning>(asWarning(storedText(WARN_KEY)))
  open = $state(false)
  why = $state<Why>('quit')
  rows = $state.raw<Stopping[]>([])
  never = $state(false)

  private pending: ((answer: Answer) => void) | null = null

  warnWhen(warning: Warning) {
    this.warning = warning
    keep(WARN_KEY, warning)
  }

  ask(why: Why, rows: Stopping[]): Promise<Answer> {
    this.pending?.('stay')
    this.why = why
    this.rows = rows
    this.never = false
    this.open = true
    return new Promise((resolve) => {
      this.pending = resolve
    })
  }

  answer(answer: Answer) {
    this.open = false
    if (answer === 'go' && this.never) this.warnWhen('never')
    this.pending?.(answer)
    this.pending = null
  }
}

export const quitAsk = new QuitAsk()
