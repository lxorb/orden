interface Ask {
  title: string
  /** Prefilled text, for a rename. */
  value?: string
  placeholder?: string
  confirmLabel?: string
}

interface Confirm {
  title: string
  /** What will happen, in one sentence. Shown under the title. */
  detail?: string
  confirmLabel?: string
  danger?: boolean
}

interface Choice {
  id: string
  label: string
  primary?: boolean
  danger?: boolean
}

interface Choose {
  title: string
  detail?: string
  options: Choice[]
}

interface SpaceOption {
  id: string
  name: string
}

interface AskName extends Ask {
  /** Offered as a dropdown beside the name. Hidden when there is only one. */
  spaces: SpaceOption[]
  space: string | null
}

interface NamedIn {
  name: string
  space: string | null
}

type Pending = { resolve: (answer: unknown) => void } | null

/** One small modal for the two questions the app ever asks: name this, and are
 *  you sure. Both resolve a promise, so the caller reads top to bottom. */
class Prompt {
  open = $state(false)
  mode = $state<'text' | 'confirm' | 'choose'>('text')
  options = $state<Choice[]>([])
  title = $state('')
  detail = $state('')
  value = $state('')
  placeholder = $state('')
  confirmLabel = $state('')
  danger = $state(false)
  spaces = $state<SpaceOption[]>([])
  space = $state<string | null>(null)

  private pending: Pending = null

  /** Resolves to the typed text, or null if it was dismissed. */
  ask(options: Ask): Promise<string | null> {
    this.mode = 'text'
    this.title = options.title
    this.detail = ''
    this.value = options.value ?? ''
    this.placeholder = options.placeholder ?? ''
    this.confirmLabel = options.confirmLabel ?? 'Create'
    this.danger = false
    this.spaces = []
    this.space = null

    return this.show() as Promise<string | null>
  }

  /** A name and the space to put it in. */
  askName(options: AskName): Promise<NamedIn | null> {
    this.mode = 'text'
    this.title = options.title
    this.detail = ''
    this.value = options.value ?? ''
    this.placeholder = options.placeholder ?? ''
    this.confirmLabel = options.confirmLabel ?? 'Save'
    this.danger = false
    this.spaces = options.spaces
    this.space = options.space ?? options.spaces[0]?.id ?? null

    return this.show() as Promise<NamedIn | null>
  }

  confirm(options: Confirm): Promise<boolean> {
    this.mode = 'confirm'
    this.title = options.title
    this.detail = options.detail ?? ''
    this.value = ''
    this.confirmLabel = options.confirmLabel ?? 'Confirm'
    this.danger = options.danger ?? false

    return this.show().then((answer) => answer !== null)
  }

  /** More than two ways to answer - resolves the chosen id, or null if the
   *  question was dismissed, which always means "do nothing". */
  choose(options: Choose): Promise<string | null> {
    this.mode = 'choose'
    this.title = options.title
    this.detail = options.detail ?? ''
    this.value = ''
    this.options = options.options
    this.spaces = []

    return this.show() as Promise<string | null>
  }

  /** Answers a `choose` with one of its options. */
  pick(id: string) {
    this.open = false
    this.pending?.resolve(id)
    this.pending = null
  }

  private show(): Promise<unknown> {
    // A second question replaces the first rather than stacking on it.
    this.pending?.resolve(null)
    this.open = true

    return new Promise((resolve) => {
      this.pending = { resolve }
    })
  }

  submit() {
    const typed = this.value.trim()
    if (this.mode === 'text' && !typed) return

    // A name asked for with spaces resolves both; everything else is a string.
    const answer = this.spaces.length ? { name: typed, space: this.space } : typed

    this.open = false
    this.pending?.resolve(this.mode === 'confirm' ? '' : answer)
    this.pending = null
  }

  dismiss() {
    this.open = false
    this.pending?.resolve(null)
    this.pending = null
  }
}

export const prompt = new Prompt()
