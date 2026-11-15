const PRESSES = ['pointerdown', 'pointerup', 'pointercancel']

const UNLOADED = [
  'dynamically imported module',
  'Importing a module script failed',
  'Unable to preload CSS',
]

function unloaded(error: unknown): boolean {
  const said = error instanceof Error ? error.message : ''
  return UNLOADED.some((one) => said.includes(one))
}

class Reloading {
  offered = $state(false)

  private asking = false
  private answered = false
  private unanswered = false

  private pressed = false
  private readonly holders = new Set<() => boolean>()

  holds(busy: () => boolean): () => void {
    this.holders.add(busy)
    return () => this.holders.delete(busy)
  }

  watch(settled: () => Promise<boolean>): () => void {
    const ask = () => void this.missed(settled)
    const missed = (event: Event) => {
      if (unloaded((event as Event & { payload?: unknown }).payload)) ask()
    }
    const back = () => {
      if (this.unanswered) ask()
    }
    const press = (event: Event) => {
      this.pressed = event.type === 'pointerdown'
    }

    addEventListener('vite:preloadError', missed)
    addEventListener('online', back)
    for (const one of PRESSES) addEventListener(one, press, { capture: true, passive: true })

    return () => {
      removeEventListener('vite:preloadError', missed)
      removeEventListener('online', back)
      for (const one of PRESSES) removeEventListener(one, press, true)
    }
  }

  private async missed(settled: () => Promise<boolean>): Promise<void> {
    if (this.asking || this.answered) return
    this.asking = true

    try {
      const { answer } = await import('./reload-when')
      this.unanswered = !(await answer({
        held: () => this.pressed || [...this.holders].some((holding) => holding()),
        settled,
        offer: () => (this.offered = true),
      }))
      this.answered = !this.unanswered
    } catch {
      this.answered = true
      this.offered = true
    } finally {
      this.asking = false
    }
  }
}

export const reloading = new Reloading()
