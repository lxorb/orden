import type { FileMark } from './file-mark'

interface Ask {
  title: string
  value?: string
  placeholder?: string
  confirmLabel?: string
}

interface Confirm {
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

interface Choose {
  title: string
  detail?: string
  options: Choice[]
}

interface ChooseTicking extends Choose {
  tick: string
}

interface Find {
  title: string
  options: Choice[]
  placeholder?: string
}

type Pending = { resolve: (answer: unknown) => void } | null

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

  private pending: Pending = null

  ask(options: Ask): Promise<string | null> {
    this.mode = 'text'
    this.title = options.title
    this.detail = ''
    this.value = options.value ?? ''
    this.placeholder = options.placeholder ?? ''
    this.confirmLabel = options.confirmLabel ?? 'Create'
    this.danger = false

    return this.show() as Promise<string | null>
  }

  confirm(options: Confirm): Promise<boolean> {
    this.mode = 'confirm'
    this.title = options.title
    this.detail = options.detail ?? ''
    this.value = ''
    this.confirmLabel = options.confirmLabel ?? 'Confirm'
    this.danger = options.danger ?? false
    this.lands = options.lands ?? false

    return this.show().then((answer) => answer !== null)
  }

  choose(options: Choose): Promise<string | null> {
    this.mode = 'choose'
    this.title = options.title
    this.detail = options.detail ?? ''
    this.value = ''
    this.options = options.options

    return this.show() as Promise<string | null>
  }

  async chooseTicking(options: ChooseTicking): Promise<{ id: string; ticked: boolean } | null> {
    const asked = this.choose(options)
    this.tick = options.tick
    this.ticked = false

    const id = await asked
    return id === null ? null : { id, ticked: this.ticked }
  }

  find(options: Find): Promise<string | null> {
    this.mode = 'find'
    this.title = options.title
    this.detail = ''
    this.value = ''
    this.placeholder = options.placeholder ?? ''
    this.options = options.options

    return this.show() as Promise<string | null>
  }

  pick(id: string) {
    this.open = false
    this.pending?.resolve(id)
    this.pending = null
  }

  private show(): Promise<unknown> {
    this.pending?.resolve(null)
    this.open = true
    this.tick = ''

    return new Promise((resolve) => {
      this.pending = { resolve }
    })
  }

  submit() {
    const typed = this.value.trim()
    if (this.mode === 'text' && !typed) return

    this.open = false
    this.pending?.resolve(this.mode === 'confirm' ? '' : typed)
    this.pending = null
  }

  dismiss() {
    this.open = false
    this.pending?.resolve(null)
    this.pending = null
  }
}

export const prompt = new Prompt()
