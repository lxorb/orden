/** The questions agents put to the reader with `ask_reader` (docs/agent-native.md 8.14,
 *  #1078), as a VS Code extension's `window.showQuickPick` and `showInputBox` put them:
 *  a choice among a few answers, or a line to type, shown in the agent's session in the
 *  Ask panel, counted on its row of the chat list and told once as a notification. Kept here, in the window, for
 *  as long as the agent is waiting; nothing of it is written down.
 *
 *  An answer the agent is waiting for comes back to its call at once; one it is not
 *  waiting for any more is kept until it asks again by the question's id. */

/** One question. */
export interface ReaderAsk {
  id: string
  agent: string
  kind: 'choice' | 'text'
  message: string
  choices: string[]
  placeholder: string | null
}

/** What became of one: the answer, or null where the reader put it away. */
interface Answered {
  answer: string | null
}

let next = 1

class Asking {
  /** The questions still waiting for the reader, oldest first. */
  waiting = $state<ReaderAsk[]>([])
  /** The answers given, by id, until the agent has heard them. */
  private readonly answered = new Map<string, Answered>()
  /** The calls waiting for an answer, by id. */
  private readonly hearing = new Map<string, ((said: Answered) => void)[]>()
  /** Whose each question is, by id. */
  private readonly owners = new Map<string, string>()

  /** A question asked, shown. */
  ask(question: Omit<ReaderAsk, 'id'>): ReaderAsk {
    const one = { ...question, id: `r${next++}` }
    this.owners.set(one.id, one.agent)
    this.waiting = [...this.waiting, one]
    return one
  }

  of(agent: string): ReaderAsk[] {
    return this.waiting.filter((one) => one.agent === agent)
  }

  /** Whether a question is this agent's and still known. */
  knows(agent: string, id: string): boolean {
    return this.owners.get(id) === agent
  }

  /** The reader's answer, or null for a question put away. */
  answer(id: string, answer: string | null): void {
    if (!this.waiting.some((one) => one.id === id)) return
    this.waiting = this.waiting.filter((one) => one.id !== id)
    const said = { answer }
    const waiting = this.hearing.get(id)
    this.hearing.delete(id)
    if (waiting?.length) for (const heard of waiting) heard(said)
    else this.answered.set(id, said)
  }

  /** The answer, waited for up to `patience`; null while there is none yet. */
  heard(id: string, patience: number): Promise<Answered | null> {
    const kept = this.answered.get(id)
    if (kept) {
      this.answered.delete(id)
      this.owners.delete(id)
      return Promise.resolve(kept)
    }
    return new Promise((settle) => {
      const heard = (said: Answered) => {
        clearTimeout(over)
        this.owners.delete(id)
        settle(said)
      }
      const over = setTimeout(() => {
        const left = (this.hearing.get(id) ?? []).filter((one) => one !== heard)
        if (left.length) this.hearing.set(id, left)
        else this.hearing.delete(id)
        settle(null)
      }, patience)
      this.hearing.set(id, [...(this.hearing.get(id) ?? []), heard])
    })
  }

  /** Every question of an agent's taken back: it was stopped, or went. */
  forget(agent: string): void {
    for (const one of this.of(agent)) this.answer(one.id, null)
  }

  /** The questions of every agent but these taken back. */
  keepOnly(agents: ReadonlySet<string>): void {
    for (const one of this.waiting) if (!agents.has(one.agent)) this.answer(one.id, null)
  }
}

export const asking = new Asking()
