import { identifier } from '../identifier'
import { isDesktop } from '../tauri'
import { cancelJob, PROGRESS } from './commands'

interface Running {
  id: string
  label: string
  bytes: number
  total: number
  items: number
  count: number
  shown: boolean
}

const SHOWN_AFTER = 400

class Jobs {
  list = $state<Running[]>([])
  #hearing: Promise<unknown> | null = null

  async run<T>(label: string, work: (id: string) => Promise<T>): Promise<T> {
    const heard = this.hear()
    const id = identifier()
    this.list = [...this.list, { id, label, bytes: 0, total: 0, items: 0, count: 0, shown: false }]
    const showing = setTimeout(() => {
      this.change(id, { shown: true })
    }, SHOWN_AFTER)
    try {
      await heard
      return await work(id)
    } finally {
      clearTimeout(showing)
      this.list = this.list.filter((one) => one.id !== id)
    }
  }

  cancel(id: string) {
    void cancelJob(id)
  }

  private change(id: string, to: Partial<Running>) {
    this.list = this.list.map((one) => (one.id === id ? { ...one, ...to } : one))
  }

  private hear(): Promise<unknown> {
    if (!isDesktop) return Promise.resolve()
    this.#hearing ??= import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<{ job: string; bytes: number; total: number; items: number; count: number }>(
          PROGRESS,
          ({ payload }) => {
            const { job, bytes, total, items, count } = payload
            this.change(job, { bytes, total, items, count })
          },
        ),
      )
      .catch(() => {
        this.#hearing = null
      })
    return this.#hearing
  }
}

export const jobs = new Jobs()
