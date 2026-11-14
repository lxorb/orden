import type { Platform } from './ui-kit/src/api'

export type Modifier = 'Shift' | 'Control' | 'Alt' | 'Meta'

const MODIFIERS: readonly Modifier[] = ['Shift', 'Control', 'Alt', 'Meta']

const isModifier = (key: string): key is Modifier => MODIFIERS.some((one) => one === key)

const WRITTEN: Record<Modifier, string> = {
  Shift: 'Shift',
  Control: 'Ctrl',
  Alt: 'Alt',
  Meta: 'Meta',
}

const primary = (platform: Platform): Modifier => (platform === 'mac' ? 'Meta' : 'Control')

export function writeTap(key: Modifier, platform: Platform): string {
  const name = key === primary(platform) ? 'Mod' : WRITTEN[key]
  return `${name} ${name}`
}

export function tapOf(text: string, platform: Platform): Modifier | null {
  const [one, other, ...rest] = text.trim().toLowerCase().split(/\s+/)
  if (one === undefined || one !== other || rest.length) return null
  if (one === 'mod') return primary(platform)

  return MODIFIERS.find((key) => WRITTEN[key].toLowerCase() === one) ?? null
}

export const WITHIN = 350

export interface Stroke {
  key: string
  repeat?: boolean
  isComposing?: boolean
  shiftKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}

function othersHeld(stroke: Stroke, key: Modifier): boolean {
  return (
    (key !== 'Shift' && stroke.shiftKey === true) ||
    (key !== 'Control' && stroke.ctrlKey === true) ||
    (key !== 'Alt' && stroke.altKey === true) ||
    (key !== 'Meta' && stroke.metaKey === true)
  )
}

export class DoubleTap {
  private down: { key: Modifier; at: number } | null = null

  private tap: { key: Modifier; at: number; spent: boolean } | null = null

  broken() {
    this.down = null
    this.tap = null
  }

  pressed(stroke: Stroke, now: number) {
    if (stroke.repeat) return
    if (stroke.isComposing || stroke.key === 'Process') {
      this.broken()
      return
    }

    const key = stroke.key
    if (isModifier(key) && this.down === null && !othersHeld(stroke, key)) {
      if (this.tap && now - this.tap.at > WITHIN) this.tap = null
      this.down = { key, at: now }
      return
    }

    this.broken()
  }

  released(stroke: Stroke, now: number): Modifier | null {
    const down = this.down
    if (down?.key !== stroke.key) {
      this.broken()
      return null
    }

    this.down = null
    if (now - down.at > WITHIN) {
      this.tap = null
      return null
    }

    const before = this.tap
    const twice = before?.key === down.key && down.at - before.at <= WITHIN

    if (twice && before.spent) {
      this.tap = { key: down.key, at: now, spent: true }
      return null
    }

    if (twice && down.key !== 'Shift') this.tap = null
    else this.tap = { key: down.key, at: now, spent: twice }
    return twice ? down.key : null
  }
}
