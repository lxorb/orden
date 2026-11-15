import { mark, sendTrace } from './trace'

const STAGES = ['index', 'search', 'icons', 'rooms', 'doors', 'left', 'right'] as const

type Stage = (typeof STAGES)[number]

function frame(): Promise<void> {
  return new Promise((go) => {
    if (typeof requestAnimationFrame !== 'function') {
      setTimeout(go, 0)
      return
    }

    requestAnimationFrame(() => requestAnimationFrame(() => go()))
  })
}

function idle(): Promise<void> {
  return new Promise((go) => {
    if (typeof requestIdleCallback !== 'function') {
      setTimeout(go, 0)
      return
    }

    requestIdleCallback(() => go(), { timeout: 500 })
  })
}

class Startup {
  private at = $state(0)
  private waiting = new Map<Stage, (() => void)[]>()
  private moving = false

  settled = $state(false)

  async shown(): Promise<void> {
    await frame()
    mark('first frame painted')
    if (!this.moving) void this.run()
  }

  async turn(stage: Stage): Promise<void> {
    if (this.reached(stage)) {
      await frame()
      return
    }

    await new Promise<void>((go) => {
      const queue = this.waiting.get(stage) ?? []
      queue.push(go)
      this.waiting.set(stage, queue)
    })
  }

  reached(stage: Stage): boolean {
    return this.at > STAGES.indexOf(stage)
  }

  reset() {
    this.at = 0
    this.settled = false
    this.waiting.clear()
    this.moving = false
  }

  private async run() {
    this.moving = true

    for (const stage of STAGES) {
      await idle()
      this.at = STAGES.indexOf(stage) + 1
      mark(`${stage} may start`)

      const queue = this.waiting.get(stage) ?? []
      this.waiting.delete(stage)
      for (const go of queue) go()
    }

    mark('launch order finished')
    sendTrace()
  }
}

export const startup = new Startup()
