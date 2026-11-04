/** A terminal dressed in Orden's own tokens, so it reads as part of the window and not as
 *  a black box dropped into it - a local terminal and an online one alike, both drawn
 *  by sessions.svelte.ts with these colours, repainted live when the theme or the scheme
 *  changes (#1069).
 *
 *  The ground and the ink are the note's, the cursor is the accent, a selection is the
 *  selection every other surface draws, and the sixteen colours a program asks for are
 *  the six the canvas already offers - red, orange, yellow, green, cyan and violet - with
 *  the syntax blue, in whichever scheme the app is in. The bright half of each is the
 *  same colour lifted towards the ink, and every one of them is moved towards the ink until
 *  it reads on the ground at WCAG's AA (`terminalPalette`). A theme may set any of them
 *  itself, `--terminal-red` and so on. A program that asks for white on a light ground,
 *  or black on a dark one, is rescued by xterm.js's own minimum contrast, which is 4.5
 *  to one here - VS Code's default for the same reason - and one that asks what the
 *  colours are (OSC 4, 10, 11) is answered by xterm.js with these.
 *
 *  xterm.js wants colours it can read without a stylesheet, so every token is resolved to
 *  a plain `#rrggbb` or `rgba()` by a canvas: a theme file may write `color-mix()` or a
 *  name, and a canvas reads whatever CSS can. */

import type { ITheme } from '@xterm/xterm'
import { TERMINAL_CONTRAST } from '../content-ground'
import { AA, hexOf, ratio, type Rgb, rgbOf } from '../legibility'

/** The tokens, in xterm.js's order of the sixteen: the six canvas colours stand in for
 *  red, green, yellow, magenta and cyan, and the syntax blue for blue. */
const ANSI = {
  red: '--canvas-1',
  green: '--canvas-4',
  yellow: '--canvas-3',
  blue: '--syntax-function',
  magenta: '--canvas-6',
  cyan: '--canvas-5',
} as const

/** A colour CSS can read, as one xterm.js can. */
function resolver(): (value: string, fallback: string) => string {
  const context = document.createElement('canvas').getContext('2d')

  return (value, fallback) => {
    if (!context || !value.trim()) return fallback
    context.fillStyle = fallback
    context.fillStyle = value.trim()
    return context.fillStyle
  }
}

/** Two colours mixed, by what CSS itself makes of it. */
function mix(
  resolve: (value: string, fallback: string) => string,
  a: string,
  b: string,
  part: number,
) {
  return resolve(`color-mix(in srgb, ${a} ${part}%, ${b})`, a)
}

/** Whether a translucent theme has made the note's paper see-through, which the
 *  terminal's ground follows: `--content-alpha` under glass and wallpaper, and nothing
 *  under every other theme. */
function seeThrough(style: CSSStyleDeclaration): boolean {
  const said = style.getPropertyValue('--content-alpha').trim()
  return said.endsWith('%') && Number.parseFloat(said) < 100
}

/** How far xterm.js pulls a program's colours from the paper: AA, or a step past it
 *  while the paper is see-through, which leaves room for the ground under it to drift
 *  as far as the theme's floors let it (see content-ground.ts). */
export function terminalContrast(root: Element = document.documentElement): number {
  return seeThrough(getComputedStyle(root)) ? TERMINAL_CONTRAST : 4.5
}

/** A colour with no alpha at all, as `rgba()`: the terminal draws no ground of its own
 *  and stands on the pane's, while xterm.js still measures contrast against this one. */
function clear(colour: string): string {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(opaque(colour).slice(at, at + 2), 16))
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, 0)`
}

/** The sixteen colours' names, in xterm.js's own order. */
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

/** Every colour a theme may set for the terminal itself, as `--terminal-<name>`: the
 *  sixteen, and the ground, the ink, the cursor and the selection. A theme that writes
 *  one has the terminal it asked for there; every other is worked out of its tokens. */
const OWN = [
  ...SIXTEEN,
  'background',
  'foreground',
  'cursor',
  'cursorAccent',
  'selectionBackground',
] as const
type Own = (typeof OWN)[number]

/** The tokens of a theme the terminal is worked out of, each a colour CSS has already
 *  read (`#rrggbb` or `rgb()`/`rgba()`): what `terminalTheme` reads off the page, and
 *  what a test hands in. */
export interface TerminalTokens {
  light: boolean
  background: string
  foreground: string
  strong: string
  muted: string
  accent: string
  /** The raised surfaces: the dark scheme's black, the light one's white. */
  ground: string
  surface: string
  selection: string
  /** The six hues the canvas offers, by the ANSI name each stands in for. */
  hues: Record<keyof typeof ANSI, string>
  /** What the theme set for the terminal itself, `--terminal-*`. */
  own?: Partial<Record<Own, string>>
}

/** How far apart a colour and the ground must be for a program's words in it to read:
 *  WCAG's AA for the twelve hues, and a large word's 3 for bright black, which a program
 *  uses for what is said quietly (a comment, a hint). */
const HUE_FLOOR = AA
const QUIET_FLOOR = 3

const mixed = ([r, g, b]: Rgb, [r0, g0, b0]: Rgb, part: number): Rgb => [
  r * part + r0 * (1 - part),
  g * part + g0 * (1 - part),
  b * part + b0 * (1 - part),
]

/** A colour moved towards `ink`, a step at a time, until it reads on `ground` at
 *  `floor`: the hue kept as long as it can be, the ink itself where nothing less does. */
function legible(colour: Rgb, ground: Rgb, ink: Rgb, floor: number): Rgb {
  for (let part = 1; part > 0; part -= 0.05) {
    const one = mixed(colour, ink, part)
    if (ratio(one, ground) >= floor) return one
  }
  return ink
}

/** The terminal's colours, worked out of a theme's tokens (#1069): the one place a
 *  theme becomes a terminal. The ground, the ink, the cursor (the accent) and the
 *  selection are the window's own; the six hues the canvas offers are red, green,
 *  yellow, magenta and cyan, and the syntax blue blue; each is moved towards the ink
 *  until it reads on the ground at AA, and its bright half is lifted further towards the
 *  strongest ink and kept apart from it. The two ends of the scale are the scheme's: on
 *  a dark ground black is a raised surface and white the ink, on a light one the other
 *  way round. A colour the theme set as `--terminal-*` is taken as it was written. */
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
    // A bright half the eye cannot tell from its colour is no second colour at all.
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

/** The palette a reader who keeps the terminal out of the theme has, whatever the theme
 *  (Settings, Terminal colours): one dark terminal, every hue clear of AA on its ground. */
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

/** The terminal's colours, off the page as it is painted right now; with `fixed`, the
 *  one palette that follows no theme. */
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

/** The colours find paints its matches in: the accent, softly, and the accent itself for
 *  the one that stands - what the find bar paints in a note - as `#rrggbb`, which is the
 *  only form the search addon takes. */
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

/** A colour with any transparency taken out, as `#rrggbb`. */
function opaque(colour: string): string {
  if (/^#[0-9a-f]{6}$/i.test(colour)) return colour

  const parts = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(colour)
  if (!parts) return '#7c6bf5'
  return `#${parts
    .slice(1, 4)
    .map((one) => Number(one).toString(16).padStart(2, '0'))
    .join('')}`
}

/** The app's monospace stack, which the terminal's type is set in: the one a code block
 *  is set in, so a command copied out of a note looks the same in the shell. */
export function monospace(root: Element = document.documentElement): string {
  return (
    getComputedStyle(root).getPropertyValue('--font-mono').trim() ||
    "ui-monospace, 'Cascadia Code', Consolas, monospace"
  )
}
