export interface Showing {
  kind:
    | 'note'
    | 'canvas'
    | 'pages'
    | 'pdf'
    | 'graph'
    | 'web'
    | 'terminal'
    | 'view'
    | 'chat'
    | 'channel'
    | 'application'
    | 'explorer'
    | 'pass'
    | 'time'
    | 'settings'
    | 'connect'
  reading: boolean
}

export interface Claims {
  overlaid: boolean
  renaming: boolean
  presenting: boolean
  touch: boolean
}

let stayingOn: Element | null = null

export function staysOn(at: Element): void {
  stayingOn = at
  const goes = ['focusout', 'keydown', 'pointerdown']
  const gone = () => {
    if (stayingOn === at) stayingOn = null
    for (const event of goes) at.removeEventListener(event, gone, true)
  }
  for (const event of goes) at.addEventListener(event, gone, true)
}

export function keyboardStays(): boolean {
  return stayingOn !== null && document.activeElement === stayingOn
}

export function takesCaret(showing: Showing | null, claims: Claims): boolean {
  if (showing?.kind !== 'note' || showing.reading) return false
  return !claims.overlaid && !claims.renaming && !claims.presenting && !claims.touch
}
