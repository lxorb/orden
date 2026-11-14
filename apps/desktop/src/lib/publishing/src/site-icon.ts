const SIZE = 32
const RADIUS = 7
const INSET = 5

const GROUND = '#17161c'
const INK = '#f4f3f8'

function opens(svg: string, attribute: string): string | null {
  return new RegExp(`\\b${attribute}="([^"]*)"`).exec(svg)?.[1] ?? null
}

export function siteIcon(mark: Element | null): string | null {
  if (!mark) return null

  const drawn = mark.querySelector('svg')
  if (drawn) {
    const box = opens(drawn.outerHTML, 'viewBox') ?? '0 0 24 24'
    const stroke = opens(drawn.outerHTML, 'stroke-width') ?? '1.7'
    const inner = drawn.innerHTML.replace(/currentColor/g, INK)
    const room = SIZE - INSET * 2

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">` +
      `<rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" fill="${GROUND}"/>` +
      `<svg viewBox="${box}" x="${INSET}" y="${INSET}" width="${room}" height="${room}"` +
      ` fill="none" stroke="${INK}" stroke-width="${stroke}"` +
      ` stroke-linecap="round" stroke-linejoin="round">${inner}</svg>` +
      `</svg>`
    )
  }

  const said = mark.textContent.trim()
  if (!said) return null

  const letter = /^[\p{L}\p{N}]$/u.test(said)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" fill="${GROUND}"/>` +
    `<text x="${SIZE / 2}" y="${SIZE - (letter ? 9 : 7)}" text-anchor="middle"` +
    (letter
      ? ` fill="${INK}" font-family="ui-sans-serif,system-ui,sans-serif" font-weight="600" font-size="19"`
      : ' font-size="24"') +
    `>${said}</text></svg>`
  )
}
