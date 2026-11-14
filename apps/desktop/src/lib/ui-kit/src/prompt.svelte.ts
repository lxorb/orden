import type { FileMark } from '@orden/contracts'

interface Held {
  until?: AbortSignal
}

interface Ask extends Held {
  title: string
  value?: string
  placeholder?: string
  confirmLabel?: string
}

interface Confirm extends Held {
  title: string
  detail?: string
  confirmLabel?: string
  danger?: boolean
  lands?: boolean
}

interface Choice {
  id: string
  label: string
  primary?: boolean
  danger?: boolean
  mark?: FileMark
  lands?: boolean
  space?: { id: string | null; name: string }
  picture?: string
}

interface Choose extends Held {
  title: string
  detail?: string
  options: Choice[]
}

interface ChooseTicking extends Choose {
  tick: string
}

interface Find extends Held {
  title: string
  options: Choice[]
  placeholder?: string
}

interface Asked {
  setup: () => void
  resolve: (answer: unknown) => void
}

class Prompt {
  open = $state(false)
  mode = $state<'text' | 'confirm' | 'choose' | 'find'>('text')
  options = $state<Choice[]>([])
  title = $state('')
  detail = $state('')
  value = $state('')
  placeholder = $state('')
  confirmLabel = $state('')
  danger = $state(false)
  lands = $state(false)
  tick = $state('')
  ticked = $state(false)

  private pending: Asked | null = null
  private waiting: Asked[] = []

  ask(options: Ask): Promise<string | null> {
    return this.show(() => {
      this.mode = 'text'
      this.title = options.title
      this.detail = ''
      this.value = options.value ?? ''
      this.placeholder = options.placeholder ?? ''
      this.confirmLabel = options.confirmLabel ?? 'Create'
      this.danger = false
    }, options.until) as Promise<string | null>
  }

  confirm(options: Confirm): Promise<boolean> {
    return this.show(() => {
      this.mode = 'confirm'
      this.title = options.title
      this.detail = options.detail ?? ''
      this.value = ''
      this.confirmLabel = options.confirmLabel ?? 'Confirm'
      this.danger = options.danger ?? false
      this.lands = options.lands ?? false
    }, options.until).then((answer) => answer !== null)
  }

  private chosen(options: Choose) {
    this.mode = 'choose'
    this.title = options.title
    this.detail = options.detail ?? ''
    this.value = ''
    this.options = options.options
  }

  choose(options: Choose): Promise<string | null> {
    return this.show(() => this.chosen(options), options.until) as Promise<string | null>
  }

  async chooseTicking(options: ChooseTicking): Promise<{ id: string; ticked: boolean } | null> {
    const id = (await this.show(() => {
      this.chosen(options)
      this.tick = options.tick
      this.ticked = false
    }, options.until)) as string | null
    return id === null ? null : { id, ticked: this.ticked }
  }

  find(options: Find): Promise<string | null> {
    return this.show(() => {
      this.mode = 'find'
      this.title = options.title
      this.detail = ''
      this.value = ''
      this.placeholder = options.placeholder ?? ''
      this.options = options.options
    }, options.until) as Promise<string | null>
  }

  pick(id: string) {
    this.answer(id)
  }

  private show(setup: () => void, until?: AbortSignal): Promise<unknown> {
    if (until?.aborted) return Promise.resolve(null)
    return new Promise((resolve) => {
      const asked: Asked = { setup, resolve }
      this.waiting.push(asked)
      until?.addEventListener('abort', () => this.withdraw(asked), { once: true })
      if (!this.pending) this.next()
    })
  }

  private withdraw(asked: Asked) {
    if (this.pending === asked) {
      this.answer(null)
      return
    }
    const at = this.waiting.indexOf(asked)
    if (at < 0) return
    this.waiting.splice(at, 1)
    asked.resolve(null)
  }

  private next() {
    if (this.pending) return
    const up = this.waiting.shift()
    if (!up) return

    this.pending = up
    this.tick = ''
    up.setup()
    this.open = true
  }

  private answer(answer: unknown) {
    const was = this.pending
    if (!was) {
      this.open = false
      return
    }

    this.open = false
    this.pending = null
    was.resolve(answer)
    if (this.waiting.length) queueMicrotask(() => this.next())
  }

  submit() {
    const typed = this.value.trim()
    if (this.mode === 'text' && !typed) return

    this.answer(this.mode === 'confirm' ? '' : typed)
  }

  dismiss() {
    this.answer(null)
  }
}

export const prompt = new Prompt()
