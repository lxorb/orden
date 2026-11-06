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
  #hearing = false

  async run<T>(label: string, work: (id: string) => Promise<T>): Promise<T> {
    this.hear()
    const id = identifier()
    this.list = [...this.list, { id, label, bytes: 0, total: 0, items: 0, count: 0, shown: false }]
    const showing = setTimeout(() => {
      this.change(id, { shown: true })
    }, SHOWN_AFTER)
    try {
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

  private hear() {
    if (this.#hearing || !isDesktop) return
    this.#hearing = true
    void import('@tauri-apps/api/event').then(({ listen }) =>
      listen<{ job: string; bytes: number; total: number; items: number; count: number }>(
        PROGRESS,
        ({ payload }) => {
          const { job, bytes, total, items, count } = payload
          this.change(job, { bytes, total, items, count })
        },
      ),
    )
  }
}

export const jobs = new Jobs()
