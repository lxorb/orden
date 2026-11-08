const LAYERS = '[role="dialog"], [role="alertdialog"], [role="menu"], [aria-modal="true"]'

const CONTROLS =
  'button:not([role]), a[href]:not([role]), summary:not([role]), select:not([role]), [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="radio"], [role="tab"], [role="slider"], [role="spinbutton"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'

const ITEMS = '[data-card], [data-item]'

const STEERED =
  'select, [role="radio"], [role="tab"], [role="slider"], [role="spinbutton"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'

const PRESSES = new Set([' ', 'Spacebar', 'Enter', 'Delete', 'Backspace', 'Tab'])

const STEERS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
])

function keyFromLayer(from: Element | null, host?: Element | null): boolean {
  const layer = from?.closest(LAYERS)
  return !!layer && !layer.contains(host ?? null)
}

function reachedByKeys(from: Element): boolean {
  try {
    return from.matches(':focus-visible')
  } catch {
    return false
  }
}

function keyForControl(event: Event, from: Element | null, host?: Element | null): boolean {
  if (!(event instanceof KeyboardEvent) || event.ctrlKey || event.metaKey || event.altKey) {
    return false
  }
  const control = from?.closest(CONTROLS)
  if (!from || !control || control === host || control.matches(ITEMS)) return false
  if (host && !host.contains(control)) return false
  if (!reachedByKeys(from)) return false
  return PRESSES.has(event.key) || (STEERS.has(event.key) && control.matches(STEERED))
}

export function keyElsewhere(event: Event, host?: Element | null): boolean {
  const from = event.target instanceof Element ? event.target : null
  return keyFromLayer(from, host) || keyForControl(event, from, host)
}
