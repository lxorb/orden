const PRESSED_THROUGH = [
  'button',
  'a[href]',
  'summary',
  'select',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="slider"]',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'input[type="range"]',
  'input[type="color"]',
  'input[type="file"]',
].join(', ')
export function adrift(at: Element | null): boolean {
  return !at || at === document.body || at === document.documentElement || !at.isConnected
}
export function pressedThrough(at: Element): boolean {
  return at.matches(PRESSED_THROUGH)
}
