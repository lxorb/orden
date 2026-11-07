import { shownWords } from '@orden/markdown/escapes'
import { type Ticked, TaskTurns } from '../task-turns'
import type { Row } from './shell'

interface Held {
  id: string
  text: string
  done: boolean
  turns: TaskTurns
}

export interface TodayHost {
  load: () => Promise<readonly { at: string; space: string; text: string }[]>
  tick: (at: string, space: string, done: boolean) => Promise<Ticked | null>
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

  private asked = 0

  fresh(): void {
    const mine = ++this.asked
    void this.host
      .load()
      .then((tasks) => {
        if (mine !== this.asked) return
        this.held = tasks.map((one) => ({
          id: `${one.space}\n${one.at}`,
          text: one.text,
          done: false,
          turns: new TaskTurns(one.at, (at, done) => this.host.tick(at, one.space, done)),
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
    void one.turns.turn(done).then((landed) => {
      if (landed || one.done !== done) return
      one.done = !done
      this.host.redraw()
    })
  }
}

export function spokenTask(said: string): string {
  return said
    .trim()
    .replace(/^\S+[\s,.:;!?-]*/u, '')
    .replace(/[.!?。]+$/u, '')
    .trim()
}
