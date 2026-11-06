import type { ITheme } from '@xterm/xterm'
import { TERMINAL_CONTRAST } from '../content-ground'
import { AA, hexOf, ratio, type Rgb, rgbOf } from '../legibility'

const ANSI = {
  red: '--canvas-1',
  green: '--canvas-4',
  yellow: '--canvas-3',
  blue: '--syntax-function',
  magenta: '--canvas-6',
  cyan: '--canvas-5',
} as const

function resolver(): (value: string, fallback: string) => string {
  const context = document.createElement('canvas').getContext('2d')

  return (value, fallback) => {
    if (!context || !value.trim()) return fallback
    context.fillStyle = fallback
    context.fillStyle = value.trim()
    return context.fillStyle
  }
}

function mix(
  resolve: (value: string, fallback: string) => string,
  a: string,
  b: string,
  part: number,
) {
  return resolve(`color-mix(in srgb, ${a} ${part}%, ${b})`, a)
}

function seeThrough(style: CSSStyleDeclaration): boolean {
  const said = style.getPropertyValue('--content-alpha').trim()
  return said.endsWith('%') && Number.parseFloat(said) < 100
}

export function terminalContrast(root: Element = document.documentElement): number {
  return seeThrough(getComputedStyle(root)) ? TERMINAL_CONTRAST : 4.5
}

function clear(colour: string): string {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(opaque(colour).slice(at, at + 2), 16))
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, 0)`
}

export function terminalGround(theme: ITheme): string | null {
  const ground = theme.background?.trim()
  if (!ground || /,\s*0(\.0*)?\)$/.test(ground) || ground === 'transparent') return null
  return ground
}

const SIXTEEN = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const

const OWN = [
  ...SIXTEEN,
  'background',
  'foreground',
  'cursor',
  'cursorAccent',
  'selectionBackground',
] as const
type Own = (typeof OWN)[number]

export interface TerminalTokens {
  light: boolean
  background: string
  foreground: string
  strong: string
  muted: string
  accent: string
  ground: string
  surface: string
  selection: string
  hues: Record<keyof typeof ANSI, string>
  own?: Partial<Record<Own, string>>
}

const HUE_FLOOR = AA
const QUIET_FLOOR = 3

const mixed = ([r, g, b]: Rgb, [r0, g0, b0]: Rgb, part: number): Rgb => [
  r * part + r0 * (1 - part),
  g * part + g0 * (1 - part),
  b * part + b0 * (1 - part),
]

function legible(colour: Rgb, ground: Rgb, ink: Rgb, floor: number): Rgb {
  for (let part = 1; part > 0; part -= 0.05) {
    const one = mixed(colour, ink, part)
    if (ratio(one, ground) >= floor) return one
  }
  return ink
}

export function terminalPalette(tokens: TerminalTokens): ITheme {
  const read = (said: string, fallback: Rgb): Rgb => rgbOf(said) ?? fallback
  const ground = read(tokens.background, tokens.light ? [255, 255, 255] : [14, 16, 19])
  const ink = read(tokens.foreground, tokens.light ? [27, 31, 36] : [221, 226, 234])
  const strong = read(tokens.strong, ink)
  const muted = read(tokens.muted, ink)
  const raised = read(tokens.ground, ground)
  const surface = read(tokens.surface, ground)

  const out: Record<string, string> = {}
  for (const [name, said] of Object.entries(tokens.hues)) {
    const hue = legible(read(said, ink), ground, ink, HUE_FLOOR)
    let bright = legible(mixed(hue, strong, 0.75), ground, strong, HUE_FLOOR)
    for (let push = 0.6; ratio(bright, hue) < 1.15 && push > 0; push -= 0.15)
      bright = legible(mixed(hue, strong, push), ground, strong, HUE_FLOOR)
    out[name] = hexOf(hue)
    out[`bright${name[0]?.toUpperCase() ?? ''}${name.slice(1)}`] = hexOf(bright)
  }
  out.black = hexOf(tokens.light ? ink : raised)
  out.brightBlack = hexOf(legible(muted, ground, ink, QUIET_FLOOR))
  out.white = hexOf(tokens.light ? raised : ink)
  out.brightWhite = hexOf(tokens.light ? surface : strong)

  const palette: ITheme = {
    background: hexOf(ground),
    foreground: hexOf(ink),
    cursor: tokens.accent,
    cursorAccent: hexOf(ground),
    selectionBackground: tokens.selection,
    ...out,
  }
  for (const [name, said] of Object.entries(tokens.own ?? {})) {
    if (said.trim()) Object.assign(palette, { [name]: said.trim() })
  }
  return palette
}

export const FIXED_PALETTE: ITheme = {
  background: '#16181d',
  foreground: '#d5d9e0',
  cursor: '#d5d9e0',
  cursorAccent: '#16181d',
  selectionBackground: 'rgba(120, 140, 180, 0.35)',
  black: '#2a2e36',
  red: '#f0727a',
  green: '#7fcf8a',
  yellow: '#e6c46c',
  blue: '#6fa8f5',
  magenta: '#c792ea',
  cyan: '#5fcfd6',
  white: '#d5d9e0',
  brightBlack: '#7d8696',
  brightRed: '#ff9aa0',
  brightGreen: '#a6e3ae',
  brightYellow: '#f5dc9a',
  brightBlue: '#9cc4ff',
  brightMagenta: '#ddb6f5',
  brightCyan: '#94e6ea',
  brightWhite: '#f4f6f9',
}

export function terminalTheme(root: Element = document.documentElement, fixed = false): ITheme {
  if (fixed) return { ...FIXED_PALETTE }
  const style = getComputedStyle(root)
  const resolve = resolver()
  const token = (name: string, fallback: string) => resolve(style.getPropertyValue(name), fallback)
  const light = root.getAttribute('data-theme') === 'light'

  const background = token('--bg', light ? '#ffffff' : '#0e1013')
  const foreground = token('--text', light ? '#1b1f24' : '#dde2ea')
  const accent = token('--accent', '#7c6bf5')
  const muted = token('--muted', '#878f9d')
  const own: Partial<Record<Own, string>> = {}
  for (const name of OWN) {
    const said = style.getPropertyValue(`--terminal-${name}`).trim()
    if (said) own[name] = resolve(said, '')
  }

  const palette = terminalPalette({
    light,
    background,
    foreground,
    strong: token('--text-strong', foreground),
    muted,
    accent,
    ground: token('--surface-3', background),
    surface: token('--surface-2', background),
    selection: token('--selection', 'rgba(124, 107, 245, 0.28)'),
    hues: Object.fromEntries(
      Object.entries(ANSI).map(([name, variable]) => [name, token(variable, foreground)]),
    ) as TerminalTokens['hues'],
    own,
  })

  const paper = palette.background ?? background
  return {
    ...palette,
    background: seeThrough(style) ? clear(paper) : paper,
    selectionInactiveBackground: mix(resolve, palette.selectionBackground ?? accent, paper, 60),
    scrollbarSliderBackground: token('--scrollbar', muted),
    scrollbarSliderHoverBackground: token('--scrollbar-hover', muted),
    scrollbarSliderActiveBackground: token('--scrollbar-hover', muted),
  }
}

export function findColours(root: Element = document.documentElement): {
  match: string
  here: string
} {
  const style = getComputedStyle(root)
  const resolve = resolver()
  const background = resolve(style.getPropertyValue('--bg'), '#0e1013')
  const accent = resolve(style.getPropertyValue('--accent'), '#7c6bf5')

  return { match: opaque(mix(resolve, accent, background, 30)), here: opaque(accent) }
}

function opaque(colour: string): string {
  if (/^#[0-9a-f]{6}$/i.test(colour)) return colour

  const parts = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(colour)
  if (!parts) return '#7c6bf5'
  return `#${parts
    .slice(1, 4)
    .map((one) => Number(one).toString(16).padStart(2, '0'))
    .join('')}`
}

export function monospace(root: Element = document.documentElement): string {
  return (
    getComputedStyle(root).getPropertyValue('--font-mono').trim() ||
    "ui-monospace, 'Cascadia Code', Consolas, monospace"
  )
}
