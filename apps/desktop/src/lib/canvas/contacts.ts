export interface Contact {
  pen: boolean
  eraser: boolean
}

const ERASER_BIT = 32
const RIGHT_BIT = 2

export interface Reported {
  pointerType: string
  button: number
  buttons: number
}

export interface Felt {
  pressure: number
  tiltX: number
  tiltY: number
  altitudeAngle?: number
  azimuthAngle?: number
}

export function hovering(event: { buttons: number }): boolean {
  return event.buttons === 0
}

export interface Glass {
  penSeen: boolean
  touch: boolean
}

export function penKind(
  event: Reported,
  glass: Glass,
): { kind: 'mouse' | 'pen' | 'touch'; eraser: boolean } {
  const held = (event.buttons & ERASER_BIT) !== 0 || (event.buttons & RIGHT_BIT) !== 0
  const asked = event.button === 2 || event.button === 5

  if (event.pointerType === 'pen') return { kind: 'pen', eraser: held || asked }
  if (event.pointerType === 'touch') return { kind: 'touch', eraser: false }

  if (glass.penSeen && glass.touch && (held || asked)) return { kind: 'pen', eraser: true }

  return { kind: 'mouse', eraser: false }
}

export interface Turned {
  eraser: boolean
  first: boolean
}

export class Contacts {
  private readonly held = new Map<number, Contact>()

  came(id: number, one: Contact) {
    this.held.set(id, one)
  }

  went(id: number) {
    this.held.delete(id)
  }

  has(id: number): boolean {
    return this.held.has(id)
  }

  get penned(): boolean {
    for (const one of this.held.values()) if (one.pen) return true
    return false
  }

  echo(event: Reported): boolean {
    return event.pointerType === 'mouse' && this.penned
  }

  turned(id: number, now: Contact): Turned | null {
    const was = this.held.get(id)
    if (!was || !now.pen) return null
    if (was.pen && (!now.eraser || was.eraser)) return null

    this.held.set(id, now)
    return { eraser: now.eraser, first: !was.pen }
  }
}

export type PenShape = 'apple' | 'windows' | 'android' | 'chromeos' | 'desktop'

export type Lean = 'tilt' | 'spherical' | 'none'

type Force = 'reported' | 'flat'

export interface PenTraits {
  shape: PenShape
  gain: number
  coalesced: boolean
  predicted: boolean
  lean: Lean
  force: Force
}

export interface Said {
  agent: string
  touch: boolean
  coalesced: boolean
  predicted: boolean
}

const APPLE = /iPad|iPhone|iPod/
const MAC = /Macintosh|Mac OS X/

export function penShape(said: Said): PenShape {
  const agent = said.agent
  if (APPLE.test(agent)) return 'apple'
  if (MAC.test(agent)) return said.touch ? 'apple' : 'desktop'
  if (agent.includes('Windows NT')) return 'windows'
  if (agent.includes('CrOS')) return 'chromeos'
  if (agent.includes('Android')) return 'android'

  return said.touch ? 'android' : 'desktop'
}

const GAINS: Record<PenShape, number> = {
  apple: 0.8,
  windows: 1,
  android: 1,
  chromeos: 1,
  desktop: 1,
}

export function penProfile(said: Said): PenTraits {
  const shape = penShape(said)

  return {
    shape,
    gain: GAINS[shape],
    coalesced: said.coalesced,
    predicted: said.predicted,
    lean: 'none',
    force: 'reported',
  }
}

export function leanOf(event: Felt): Lean {
  if (event.tiltX !== 0 || event.tiltY !== 0) return 'tilt'

  const up = event.altitudeAngle
  if (typeof up === 'number' && up < Math.PI / 2) return 'spherical'

  return 'none'
}

const WATCHED = 24

export class Stylus {
  traits: PenTraits
  private was: number | null = null
  private varied = false
  private seen = 0

  constructor(said: Said) {
    this.traits = penProfile(said)
  }

  saw(event: Reported & Felt): boolean {
    if (event.pointerType !== 'pen') return false

    let changed = false

    const lean = leanOf(event)
    if (lean !== 'none' && lean !== this.traits.lean) {
      this.traits = { ...this.traits, lean }
      changed = true
    }

    if (this.varied || hovering(event)) return changed

    if (this.was !== null && event.pressure !== this.was) {
      this.varied = true
      if (this.traits.force !== 'reported') {
        this.traits = { ...this.traits, force: 'reported' }
        changed = true
      }

      return changed
    }

    this.was = event.pressure
    this.seen += 1
    if (this.seen >= WATCHED && this.traits.force !== 'flat') {
      this.traits = { ...this.traits, force: 'flat' }
      changed = true
    }

    return changed
  }

  get line(): string {
    const traits = this.traits

    return [
      traits.shape,
      `g${traits.gain}`,
      traits.lean,
      traits.force,
      traits.coalesced ? 'coalesced' : 'plain',
      traits.predicted ? 'predicted' : 'unguessed',
    ].join(' ')
  }
}
