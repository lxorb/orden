import { WITHIN } from '../double-tap'
import type { Platform } from '../ui-kit/src/api'
import { underAlt } from './letters'

const PLACES: readonly (readonly [string, number | 'last'])[] = [
  ...Array.from({ length: 8 }, (_, at) => [`app.note-${at + 1}.alt`, at] as const),
  ['app.note-ninth', 8],
  ['app.note-9.alt', 'last'],
]

export function numerals(
  count: number,
  keyFor: (id: string) => string | null,
  platform: Platform,
): (string | null)[] {
  const worn: (string | null)[] = Array.from({ length: count }, () => null)

  for (const [id, place] of PLACES) {
    const said = underAlt(keyFor(id), platform)
    const at = place === 'last' ? count - 1 : place
    if (said !== null && at >= 0 && at < count) worn[at] = said
  }

  return worn
}

export interface Stroke {
  key: string
  code: string
  altKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  metaKey: boolean
  repeat: boolean
  altGraph: boolean
}

function isDigit(stroke: Stroke): boolean {
  return (
    /^Digit\d$/.test(stroke.code) || (/^\d$/.test(stroke.key) && !stroke.code.startsWith('Numpad'))
  )
}

export class AltHold {
  holding = false
  private spent = false
  private tapped = Number.NEGATIVE_INFINITY
  private since = Number.NEGATIVE_INFINITY
  private quiet = false

  down(stroke: Stroke, now = Number.NaN, claimed = false): boolean {
    const alone = !stroke.ctrlKey && !stroke.shiftKey && !stroke.metaKey && !stroke.altGraph

    if (stroke.key === 'Alt') {
      if (stroke.repeat || this.holding || this.spent) return false
      this.since = now
      if (now - this.tapped <= WITHIN) {
        this.spent = true
        this.quiet = alone
        return false
      }
      this.holding = alone
      this.spent = !alone
      return this.holding
    }

    this.tapped = Number.NEGATIVE_INFINITY
    if (!stroke.altKey) {
      this.forget()
      return false
    }
    if (this.holding) return true
    if (!alone || !(isDigit(stroke) || claimed)) return false
    this.holding = true
    this.spent = false
    this.quiet = false
    return true
  }

  sense(alt: boolean, altGraph = false): boolean {
    if (!alt) {
      this.forget()
      return false
    }
    if (this.holding || this.spent || altGraph) return false
    this.holding = true
    return true
  }

  released(now = Number.NaN): void {
    const tap = (this.holding || this.quiet) && now - this.since <= WITHIN
    this.tapped = tap ? now : Number.NEGATIVE_INFINITY
    this.quiet = false
    this.holding = false
    this.spent = false
  }

  private forget() {
    this.holding = false
    this.spent = false
    this.quiet = false
  }
}
