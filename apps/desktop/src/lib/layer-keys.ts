const LAYERS = '[role="dialog"], [role="alertdialog"], [role="menu"], [aria-modal="true"]'

export function keyFromLayer(event: Event, host?: Element | null): boolean {
  const from = event.target instanceof Element ? event.target : null
  const layer = from?.closest(LAYERS)
  return !!layer && !layer.contains(host ?? null)
}
