import { forget, isNumber, isRecord, isString, keepJson, stored } from '../stored'

export type Scheme = 'dark' | 'light'

export interface Ground {
  colour: string
  scheme: Scheme
}

export interface Worn {
  scheme: Scheme
  tint: string
  second?: string
  wash: number
  paper?: number
  terminal?: number
}

interface Kept extends Worn {
  app: Scheme
  tab: string | null
  bar: Ground | null
}

const KEY = 'nib:glass-chrome'

const PAINTED = [
  '--glass-tint',
  '--glass-tint-2',
  '--glass-tinted',
  '--content-alpha',
  '--terminal-alpha',
  '--content-inner',
] as const

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

function isScheme(value: unknown): value is Scheme {
  return value === 'dark' || value === 'light'
}

const HEX = /^#[0-9a-f]{6}$/i

function isGround(value: unknown): value is Ground {
  return isRecord(value) && isString(value.colour) && isScheme(value.scheme)
}

function kept(): Kept | null {
  const said = stored(KEY)
  if (!isRecord(said) || !isScheme(said.app) || !isScheme(said.scheme)) return null
  if (!isString(said.tint) || !HEX.test(said.tint) || !isNumber(said.wash)) return null
  return {
    app: said.app,
    scheme: said.scheme,
    tint: said.tint,
    ...(isString(said.second) && HEX.test(said.second) ? { second: said.second } : {}),
    wash: said.wash,
    ...(isNumber(said.paper) ? { paper: said.paper } : {}),
    ...(isNumber(said.terminal) ? { terminal: said.terminal } : {}),
    tab: isString(said.tab) ? said.tab : null,
    bar: isGround(said.bar) ? said.bar : null,
  }
}

class Chrome {
  on = $state(false)
  app = $state<Scheme>('dark')
  frame = $state<Scheme | null>(null)
  bars = $state<Record<string, Ground>>({})
  terminal = $state<string | null>(null)
  material = $state<string | null>(null)
  floor = $state(0)
  private standing: MutationObserver | null = null

  readonly theme = $derived<Scheme | undefined>(
    this.on && this.frame !== null && this.frame !== this.app ? this.frame : undefined,
  )

  barOf(tab: string): Ground | undefined {
    return this.on ? this.bars[tab] : undefined
  }

  barTheme(tab: string): Scheme | undefined {
    const scheme = this.barOf(tab)?.scheme
    return scheme === this.app ? undefined : scheme
  }

  tabTheme(tab: string): Scheme | undefined {
    if (!this.on) return undefined
    const own = this.bars[tab]?.scheme ?? this.app
    return own === (this.theme ?? this.app) ? undefined : own
  }

  wake(app: Scheme): void {
    const was = this.on
    this.app = app
    if (was) return

    this.on = true
    const root = document.documentElement
    root.dataset.tinted = ''
    const stands = () => {
      this.material = root.dataset.translucent ?? null
    }
    stands()
    if (typeof MutationObserver === 'function') {
      this.standing = new MutationObserver(stands)
      this.standing.observe(root, { attributes: true, attributeFilter: ['data-translucent'] })
    }
    const last = kept()
    if (last?.app !== app) return

    this.paint(last)
    this.frame = last.scheme
    if (last.tab !== null && last.bar !== null) this.bars = { [last.tab]: last.bar }
  }

  sleep(): void {
    if (!this.on) return

    this.on = false
    this.standing?.disconnect()
    this.standing = null
    this.frame = null
    this.bars = {}
    const root = document.documentElement
    delete root.dataset.tinted
    delete root.dataset.paired
    for (const token of PAINTED) root.style.removeProperty(token)
  }

  wear(worn: Worn, bars: Record<string, Ground>, tab: string | null): void {
    if (!this.on) return

    this.paint(worn)
    if (this.frame !== worn.scheme) this.frame = worn.scheme
    if (JSON.stringify(bars) !== JSON.stringify(this.bars)) this.bars = bars

    const next: Kept = {
      ...worn,
      app: this.app,
      tab,
      bar: tab === null ? null : (bars[tab] ?? null),
    }
    const text = JSON.stringify(next)
    if (text === this.written) return
    this.written = text
    keepJson(KEY, next)
  }

  forget(): void {
    forget(KEY)
    this.written = ''
  }

  private written = ''

  private paint(worn: Worn): void {
    const style = document.documentElement.style
    document.documentElement.toggleAttribute('data-paired', worn.second !== undefined)
    const said: Record<(typeof PAINTED)[number], string> = {
      '--glass-tint': worn.tint,
      '--glass-tint-2': worn.second ?? worn.tint,
      '--glass-tinted': percent(worn.wash),
      '--content-alpha': percent(worn.paper ?? 1),
      '--terminal-alpha': percent(worn.terminal ?? 1),
      '--content-inner': (worn.paper ?? 1) < 1 ? 'transparent' : 'initial',
    }
    for (const token of PAINTED) {
      if (style.getPropertyValue(token) !== said[token]) style.setProperty(token, said[token])
    }
  }
}

export const chrome = new Chrome()

export function landed(tab: string): void {
  if (chrome.on) void import('./follow.svelte').then((one) => one.landed(tab))
}
