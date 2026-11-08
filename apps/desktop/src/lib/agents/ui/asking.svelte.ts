export interface ReaderAsk {
  id: string
  agent: string
  kind: 'choice' | 'text'
  message: string
  choices: string[]
  placeholder: string | null
}

interface Answered {
  answer: string | null
}

let next = 1

class Asking {
  waiting = $state<ReaderAsk[]>([])
  private readonly answered = new Map<string, Answered>()
  private readonly hearing = new Map<string, ((said: Answered) => void)[]>()
  private readonly owners = new Map<string, string>()

  ask(question: Omit<ReaderAsk, 'id'>): ReaderAsk {
    const one = { ...question, id: `r${next++}` }
    this.owners.set(one.id, one.agent)
    this.waiting = [...this.waiting, one]
    return one
  }

  of(agent: string): ReaderAsk[] {
    return this.waiting.filter((one) => one.agent === agent)
  }

  knows(agent: string, id: string): boolean {
    return this.owners.get(id) === agent
  }

  answer(id: string, answer: string | null): void {
    if (!this.waiting.some((one) => one.id === id)) return
    this.waiting = this.waiting.filter((one) => one.id !== id)
    const said = { answer }
    const waiting = this.hearing.get(id)
    this.hearing.delete(id)
    if (waiting?.length) for (const heard of waiting) heard(said)
    else this.answered.set(id, said)
  }

  heard(id: string, patience: number, signal?: AbortSignal): Promise<Answered | null> {
    const kept = this.answered.get(id)
    if (kept) {
      this.answered.delete(id)
      this.owners.delete(id)
      return Promise.resolve(kept)
    }
    return new Promise((settle) => {
      const heard = (said: Answered) => {
        clearTimeout(over)
        signal?.removeEventListener('abort', unheard)
        this.owners.delete(id)
        settle(said)
      }
      const unheard = () => {
        clearTimeout(over)
        const left = (this.hearing.get(id) ?? []).filter((one) => one !== heard)
        if (left.length) this.hearing.set(id, left)
        else this.hearing.delete(id)
        settle(null)
      }
      const over = setTimeout(unheard, patience)
      signal?.addEventListener('abort', unheard, { once: true })
      const gathered = this.hearing.get(id)
      if (gathered) gathered.push(heard)
      else this.hearing.set(id, [heard])
    })
  }

  forget(agent: string): void {
    for (const one of this.of(agent)) this.answer(one.id, null)
  }

  keepOnly(agents: ReadonlySet<string>): void {
    for (const one of this.waiting) if (!agents.has(one.agent)) this.answer(one.id, null)
  }
}

export const asking = new Asking()
