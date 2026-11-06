import { shownWords } from '@orden/markdown/escapes'
import type { Row } from './shell'

interface Held {
  id: string
  at: string
  space: string
  text: string
  done: boolean
}

export interface TodayHost {
  load: () => Promise<readonly { at: string; space: string; text: string }[]>
  tick: (at: string, space: string, done: boolean) => Promise<boolean>
  redraw: () => void
}

const OPEN = '□ '
const DONE = '■ '

export class Today {
  private held: Held[] = []

  constructor(private readonly host: TodayHost) {}

  rows(): Row[] {
    return this.held.map((one) => ({
      label: `${one.done ? DONE : OPEN}${shownWords(one.text)}`,
      depth: 0,
      folder: false,
      open: false,
      pick: true,
      id: one.id,
    }))
  }

  fresh(): void {
    void this.host
      .load()
      .then((tasks) => {
        this.held = tasks.map((one) => ({
          id: `${one.space}\n${one.at}`,
          at: one.at,
          space: one.space,
          text: one.text,
          done: false,
        }))
        this.host.redraw()
      })
      .catch(() => undefined)
  }

  tick(id: string): void {
    const one = this.held.find((row) => row.id === id)
    if (!one) return
    one.done = !one.done
    const done = one.done
    void this.host
      .tick(one.at, one.space, done)
      .then((found) => {
        if (found) return
        one.done = !done
        this.host.redraw()
      })
      .catch(() => undefined)
  }
}

export function spokenTask(said: string): string {
  return said
    .trim()
    .replace(/^\S+[\s,.:;!?-]*/u, '')
    .replace(/[.!?。]+$/u, '')
    .trim()
}
