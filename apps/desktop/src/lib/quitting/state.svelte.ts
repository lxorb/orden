import { shells } from '../terminal/shells.svelte'
import type { Row, Why } from './rows'

type Answer = 'go' | 'stay' | Row

class QuitAsk {
  open = $state(false)
  why = $state<Why>('quit')
  rows = $state.raw<Row[]>([])
  never = $state(false)

  private pending: ((answer: Answer) => void) | null = null

  ask(why: Why, rows: Row[]): Promise<Answer> {
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
    if (answer === 'go' && this.never) shells.setWarning('never')
    this.pending?.(answer)
    this.pending = null
  }
}

export const quitAsk = new QuitAsk()
