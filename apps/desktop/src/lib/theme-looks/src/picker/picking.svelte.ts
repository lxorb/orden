import { mount } from 'svelte'
import { type SchemeChoice, theme } from '../../../theme/src/api'
import ThemePicker from './ThemePicker.svelte'

interface Look {
  id: string
  scheme: SchemeChoice
  accent: string
}

type Part = keyof Look

type Pointed = { [P in Part]: Look[P] | null }

interface Anchor {
  x: number
  top: number
  bottom: number
}

const NOTHING: Pointed = { id: null, scheme: null, accent: null }

class Picking {
  open = $state(false)
  at = $state<Anchor | null>(null)
  query = $state('')
  pointed = $state<Pointed>({ ...NOTHING })

  constructor() {
    theme.rewore(() => this.follow())
  }

  get kept(): Look {
    return theme.kept
  }

  show(at: Anchor | null) {
    if (this.open) return

    theme.warm()
    this.pointed = { ...NOTHING }
    this.query = ''
    this.at = at
    this.open = true
  }

  point<P extends Part>(part: P, value: Look[P] | null) {
    if (!this.open || this.pointed[part] === value) return

    this.pointed[part] = value
    this.paint()
  }

  keepTheme(id: string) {
    theme.select(id)
    this.pointed.id = null
    this.paint()
  }

  keepScheme(choice: SchemeChoice) {
    if (!theme.offers(choice)) return

    theme.setScheme(choice)
    this.pointed.scheme = null
    this.paint()
  }

  keepAccent(id: string) {
    theme.setAccent(id)
    this.pointed.accent = null
    this.paint()
  }

  private follow() {
    if (this.open) this.paint()
  }

  close() {
    if (!this.open) return

    const pointing = Object.values(this.pointed).some((one) => one !== null)
    this.pointed = { ...NOTHING }
    if (pointing) this.paint()
    this.open = false
  }

  private paint() {
    const { id, scheme, accent } = this.pointed
    theme.preview(id ?? this.kept.id, scheme ?? this.kept.scheme, accent ?? this.kept.accent)
  }
}

export const picking = new Picking()

let mounted = false

function anchorOf(press: MouseEvent): Anchor | null {
  const on = press.target instanceof Element ? press.target.closest('button') : null
  if (on) {
    const box = on.getBoundingClientRect()
    return { x: press.clientX || box.left + box.width / 2, top: box.top, bottom: box.bottom }
  }

  if (!press.clientX && !press.clientY) return null
  return { x: press.clientX, top: press.clientY, bottom: press.clientY }
}

export function pickTheme(from?: MouseEvent): void {
  if (!mounted) {
    mount(ThemePicker, { target: document.body })
    mounted = true
  }

  picking.show(from ? anchorOf(from) : null)
}
