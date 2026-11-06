export type TaskKind = 'goal' | 'loop' | 'subtask' | 'batch' | 'research' | 'fork'

interface Task {
  id: string
  thread: string
  kind: TaskKind
  label: string
  started: number
  helper?: string
  stop(): void
}

class Tasks {
  list = $state.raw<Task[]>([])

  private told: ((thread: string) => void) | null = null

  watch(tell: (thread: string) => void): () => void {
    this.told = tell
    return () => {
      if (this.told === tell) this.told = null
    }
  }

  add(task: Omit<Task, 'id' | 'started'>): Task {
    const made: Task = { ...task, id: crypto.randomUUID(), started: Date.now() }
    this.list = [...this.list, made]
    this.told?.(made.thread)
    return made
  }

  done(id: string): void {
    const ending = this.list.find((one) => one.id === id)
    this.list = this.list.filter((one) => one.id !== id)
    if (ending) this.told?.(ending.thread)
  }

  of(thread: string): Task[] {
    return this.list.filter((one) => one.thread === thread)
  }

  stop(thread: string, kind?: TaskKind): number {
    const ending = this.of(thread).filter((one) => !kind || one.kind === kind)
    for (const one of ending) {
      this.done(one.id)
      one.stop()
    }
    return ending.length
  }
}

export const tasks = new Tasks()
