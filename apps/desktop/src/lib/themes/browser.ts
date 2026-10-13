/** A Chrome or Firefox theme as one of Orden's: the parts of a browser's window, said
 *  as the tokens of the parts of this one they are nearest to.
 *
 *  Both browsers name the parts the same way in a manifest's `theme.colors`, Firefox
 *  having taken Chrome's keys and added its own, so one table reads either. A
 *  `userChrome.css` names nothing: it restyles Firefox's own window, so it is read
 *  back into those keys (`PAINTED`) by the cascade's rules, as far as a sheet can be
 *  held to them without its document.
 *
 *  Words always read. A ground is taken only if the ink reads on it and an ink only if
 *  it reads on the ground, so a part the theme leaves out, or colours for words Orden
 *  does not write there, falls to the next nearest and at last to the scheme's own.
 *  What a browser has no part for at all is mixed from the ground and the ink beside
 *  it (`DERIVED`). A see-through colour is laid over the scheme's page, and kept as it
 *  was written for the window that is see-through itself (`GLASS`). Pure; see
 *  browser.test.ts. */

import { BODY } from '../content-ground'
import { AA, hexOf, inkFor, luminance, over, ratio, type Rgb, rgbOf } from '../legibility'
import type { Scheme } from '../theme.svelte'
import { substituted } from '../theme-picker/looks'
import { closes, declarationsOf } from './validate'

/** One theme as its browser holds it; see browser_themes.rs. */
export interface BrowserTheme {
  name: string
  source: string
  css: boolean
  /** A Firefox profile's `userContent.css`, or nothing. */
  pages: string
}

/** A theme's keys, each with every colour said for it, the likeliest first. */
type Parts = Record<string, string[]>

const BLACK: Rgb = [0, 0, 0]
const WHITE: Rgb = [255, 255, 255]
const GREY: Rgb = [128, 128, 128]
const NAMED: Record<string, string> = { black: '#000', white: '#fff', transparent: 'rgba(0,0,0,0)' }
const SCHEMES: Scheme[] = ['light', 'dark']
/** Short of what `write_theme` takes, by the room a stamp needs; see themes.rs. */
const MOST = 60_000

const PAGE = ['ntp_background', 'tab_selected', 'toolbar', 'frame']
const WORDS = [
  'ntp_text',
  'toolbar_text',
  'bookmark_text',
  'tab_text',
  'sidebar_text',
  'popup_text',
]
const ACCENT = ['tab_line', 'icons_attention', 'toolbar_field_border_focus', 'ntp_link']

/** The other grounds Orden paints and the parts of a browser nearest to each, nearest
 *  first. The note is the page (`PAGE`), and its open tab is cut out of the frame in
 *  the note's colour as a browser's is in the toolbar's; the panels and menus are the
 *  toolbar, and a frame the theme sees through is the toolbar too. */
const GROUNDS: Record<string, string[]> = {
  '--surface': ['toolbar', 'popup', 'frame'],
  '--tab-frame': ['frame', 'toolbar'],
  '--side-bar-bg-color': ['sidebar'],
}

/** What stands on the desk where the window is see-through, as glass.css says it: the
 *  shell the frame is on, the paper and the list, each in the alpha the theme wrote. A
 *  frame the theme sees through altogether is a shell that is clear; any other part
 *  that clear is not there. */
const GLASS: Record<string, string[]> = {
  '--shell-ground': ['frame', 'toolbar'],
  '--content-ground': PAGE,
  '--side-bar-bg-color': ['sidebar'],
}

/** And what follows from standing there: the frame is the shell's and so is a pane
 *  with nothing open, the open tab and a terminal are the paper, and a row under the
 *  pointer is a lift of what it is on. */
const ON_GLASS: Record<string, string> = {
  '--tab-frame': 'transparent',
  '--empty-ground': 'transparent',
  '--paper': 'var(--content-ground)',
  '--terminal-ground': 'var(--content-ground)',
  '--item-hover-bg-color': 'color-mix(in srgb, var(--text) 8%, transparent)',
}

/** What no browser has a part for, in the steps the built-in palette takes between
 *  its own ground and ink. */
const DERIVED: Record<string, string> = {
  '--surface-2': 'color-mix(in srgb, var(--surface) 96%, var(--text))',
  '--surface-3': 'color-mix(in srgb, var(--surface) 92%, var(--text))',
  '--press': 'color-mix(in srgb, var(--surface) 88%, var(--text))',
  '--line': 'color-mix(in srgb, var(--bg) 89%, var(--text))',
  '--line-strong': 'color-mix(in srgb, var(--bg) 82%, var(--text))',
  '--muted': 'color-mix(in srgb, var(--text) 64%, var(--bg))',
  '--muted-strong': 'color-mix(in srgb, var(--text) 76%, var(--bg))',
  '--faint': 'color-mix(in srgb, var(--text) 50%, var(--bg))',
}

/** And the rest of an accent, for a theme that brings one; see accents.ts. */
const ACCENTED: Record<string, string> = {
  '--accent-hover': 'color-mix(in srgb, var(--accent) 86%, var(--text))',
  '--accent-press': 'color-mix(in srgb, var(--accent) 74%, var(--text))',
  '--accent-soft': 'color-mix(in srgb, var(--accent) 15%, transparent)',
  '--accent-line': 'color-mix(in srgb, var(--accent) 40%, transparent)',
  '--selection': 'color-mix(in srgb, var(--accent) 25%, transparent)',
}

/** Firefox's own map from a theme's keys to its window, read backwards: the variable
 *  each part is painted from, then the element that wears it, whose `color` is read
 *  for a `_text` and whose `background` for anything else. */
const PAINTED: Parts = {
  frame: ['--lwt-accent-color', '--toolbox-bgcolor', '#navigator-toolbox', '#TabsToolbar'],
  toolbar: ['--toolbar-bgcolor', '#nav-bar', '.browser-toolbar'],
  toolbar_text: ['--toolbar-color', '#nav-bar', '.toolbarbutton-text'],
  tab_selected: ['--tab-selected-bgcolor', '.tab-background[selected]'],
  tab_text: ['--tab-selected-textcolor'],
  tab_line: ['--lwt-tab-line-color'],
  ntp_background: ['--newtab-background-color', '#tabbrowser-tabpanels'],
  ntp_text: ['--newtab-text-primary-color'],
  popup: ['--arrowpanel-background', 'menupopup'],
  popup_text: ['--arrowpanel-color', 'menupopup'],
  sidebar: ['--sidebar-background-color', '#sidebar-box'],
  sidebar_text: ['--sidebar-text-color', '#sidebar-box'],
}

/** One declaration of a sheet: a custom property under its own name, anything else as
 *  `element property`, with what decides whether it wins and the scheme its media
 *  query is for, null for both. */
interface Said {
  name: string
  value: string
  important: boolean
  scheme: Scheme | null
}

/** The element a selector colours: its last part, with the tag off the front. */
const elementOf = (selector: string) =>
  selector
    .trim()
    .replace(/^[^]*[\s>]/, '')
    .replace(/^[a-z-]+(?=[#.])/, '')

/** Every declaration of a sheet, media queries opened. */
function* saidIn(css: string, scheme: Scheme | null = null): Generator<Said> {
  let start = 0

  for (let open = css.indexOf('{'); open >= 0; open = css.indexOf('{', start)) {
    const close = closes(css, open)
    const prelude = css.slice(start, open)
    const body = css.slice(open + 1, close)
    start = close + 1

    if (body.includes('{')) {
      const asked = /prefers-color-scheme:\s*(light|dark)/.exec(prelude)?.[1] as Scheme | undefined
      yield* saidIn(body, asked ?? scheme)
      continue
    }

    const elements = prelude
      .slice(prelude.lastIndexOf(';') + 1)
      .split(',')
      .map(elementOf)
    for (const [property, written] of declarationsOf(body)) {
      const value = written.replace(/!\s*important\s*$/i, '').trim()
      const names = property.startsWith('--')
        ? [property]
        : elements.map((one) => `${one} ${property.replace('-color', '')}`)
      for (const name of names) yield { name, value, important: value !== written, scheme }
    }
  }
}

/** A sheet as a theme's keys for one scheme: the last of the strongest of each name,
 *  its `var()`s worked out against the rest. */
function partsOfSheet(said: Said[], scheme: Scheme): Parts {
  const best = new Map<string, Said>()
  for (const one of said) {
    if (one.scheme !== null && one.scheme !== scheme) continue
    if (one.important || best.get(one.name)?.important !== true) best.set(one.name, one)
  }

  const known = new Map([...best].map(([name, one]) => [name, one.value]))
  const colourOf = (key: string, source: string) => {
    const property = key.endsWith('_text') ? 'color' : 'background'
    return substituted(
      known.get(source.startsWith('--') ? source : `${source} ${property}`) ?? '',
      known,
    )
  }
  return Object.fromEntries(
    Object.entries(PAINTED).map(([key, sources]) => [
      key,
      sources.flatMap((source) => colourOf(key, source) ?? []),
    ]),
  )
}

/** A manifest's `theme` as the same: its colours, a list of channels written out. */
function partsOfManifest(source: string): Parts {
  const colors = (JSON.parse(source) as { colors?: Record<string, unknown> }).colors ?? {}
  const written = (value: unknown) =>
    Array.isArray(value) ? `rgba(${value.join(', ')})` : String(value)
  return Object.fromEntries(Object.entries(colors).map(([key, value]) => [key, [written(value)]]))
}

/** A colour and how much of it there is, or null for what is not a colour. */
function parsed(said: string): [Rgb, number] | null {
  const text = said.trim().toLowerCase()
  const hex = /^#([0-9a-f]{4}|[0-9a-f]{8})$/.exec(text)?.[1] ?? ''
  const cut = (hex.length * 3) / 4
  const last = hex.slice(cut).padEnd(2, hex.slice(-1))

  const named = NAMED[text] ?? text
  const rgb = rgbOf(hex ? `#${hex.slice(0, cut)}` : named)
  const fourth = hex ? `${Number.parseInt(last, 16) / 2.55}%` : named.match(/[\d.]+%?/g)?.[3]
  const alpha = fourth ? Number.parseFloat(fourth) / (fourth.endsWith('%') ? 100 : 1) : 1
  return rgb && [rgb, alpha]
}

/** That colour laid over what is under it, or null for one that is not there at all:
 *  `transparent` says the part shows whatever is behind it. */
function solid(said: string, under: Rgb): Rgb | null {
  const [rgb, alpha] = parsed(said) ?? [BLACK, 0]
  return alpha > 0 ? over(rgb, alpha, under) : null
}

/** Every colour a theme says for any of some keys, the nearest key's first. */
function coloursOf(parts: Parts, keys: string[], under: Rgb): Rgb[] {
  const said = keys.flatMap((key) => parts[key] ?? [])
  return said.map((one) => solid(one, under)).filter((one) => one !== null)
}

/** The tokens one scheme of a theme states, or none for one with no ground words can
 *  be read on. The ink is the theme's where that reads as body text does, else black
 *  or white; every other ground has to carry it, and an accent to read on the note
 *  and not to be the ink over again. */
function tokensOf(parts: Parts, scheme: Scheme): Record<string, string> {
  const under = scheme === 'dark' ? BLACK : WHITE
  const inks = [...coloursOf(parts, WORDS, under), BLACK, WHITE]
  const inkOn = (ground: Rgb) => inks.find((one) => ratio(one, ground) >= BODY)
  const ground = coloursOf(parts, PAGE, under).find(inkOn)
  const ink = ground && inkOn(ground)
  if (!ground || !ink) return {}

  const said = { '--bg': hexOf(ground), '--text': hexOf(ink), '--text-strong': hexOf(ink) }
  const tokens: Record<string, string> = { ...DERIVED, ...said }
  for (const [token, keys] of Object.entries(GROUNDS)) {
    const found = coloursOf(parts, keys, under).find((one) => ratio(ink, one) >= AA)
    if (found) tokens[token] = hexOf(found)
  }

  const stands = (one: Rgb) => ratio(one, ground) >= AA && ratio(one, ink) > 1
  const accent = coloursOf(parts, ACCENT, under).find(stands)
  if (!accent) return tokens
  const inked = { '--accent': hexOf(accent), '--accent-ink': hexOf(inkFor(accent, [BLACK, WHITE])) }
  return { ...tokens, ...inked, ...ACCENTED }
}

/** The tokens a theme states over the desk, or none for one that is solid throughout. */
function glassOf(parts: Parts): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const [token, keys] of Object.entries(GLASS)) {
    const said = keys.flatMap((key) => parts[key] ?? []).map(parsed)
    const found = said.find((one) => one !== null && (one[1] > 0 || token === '--shell-ground'))
    if (found) tokens[token] = `rgb(${found[0].join(' ')} / ${found[1].toFixed(3)})`
  }

  const clear = Object.values(tokens).some((one) => !one.endsWith('/ 1.000)'))
  return clear ? { ...tokens, ...ON_GLASS } : {}
}

/** The addresses each function of `@-moz-document` is for, as a pattern. */
const escaped = (said: string) => said.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const ADDRESSED: Record<string, (said: string) => string> = {
  url: (said) => `^${escaped(said)}$`,
  'url-prefix': (said) => `^${escaped(said)}`,
  domain: (said) => `^[a-z-]+://([^/]*\\.)?${escaped(said)}[/:]`,
  regexp: (said) => `^(?:${said.replace(/\\\\/g, '\\')})$`,
}

/** A `userContent.css` as the line a theme file says its pages on, or nothing for one
 *  that says nothing: each `@-moz-document` block with the addresses it is for, and
 *  the rest for every page. `clear` is whether every page's own ground is seen
 *  through, which is what makes its webview clear; see page_style.rs. */
export function paged(css: string): string {
  const sheets = [{ match: '', css: '' }]
  let start = 0

  for (let open = css.indexOf('{'); open >= 0; open = css.indexOf('{', start)) {
    const close = closes(css, open)
    const prelude = css.slice(start, open)
    const whole = css.slice(start, close + 1)
    start = close + 1

    const said = [...prelude.matchAll(/(url-prefix|url|domain|regexp)\(\s*(['"]?)(.*?)\2\s*\)/g)]
    const match = said.map(([, kind, , text]) => ADDRESSED[kind ?? '']?.(text ?? '')).join('|')
    if (!prelude.includes('@-moz-document') && sheets[0]) sheets[0].css += whole
    else if (match) sheets.push({ match, css: css.slice(open + 1, close) })
  }

  const grounds = [...saidIn(sheets[0]?.css ?? '')].filter((one) =>
    /^(:root|html|body) background$/.test(one.name),
  )
  const clear = grounds.some((one) => (parsed(one.value)?.[1] ?? 1) < 1)
  const worth = sheets.filter((one) => one.css.trim())
  if (!worth.length) return ''
  return `/*! nib-pages ${JSON.stringify({ clear, sheets: worth }).replace(/\//g, '\\/')} */\n`
}

/** The theme as a sheet Orden wears, a block for each scheme it states, or nothing
 *  for a theme that colours no ground. One that says nothing of schemes is one look:
 *  whichever side of grey its ground lands on. A second block is for the window that
 *  is see-through, and stands unread where the platform has nothing to see through. */
export function ordenCss(theme: BrowserTheme): string {
  const said = theme.css ? [...saidIn(theme.source)] : []
  const partsFor = (scheme: Scheme) =>
    theme.css ? partsOfSheet(said, scheme) : partsOfManifest(theme.source)

  const stated = SCHEMES.filter((scheme) => said.some((one) => one.scheme === scheme))
  const [ground] = coloursOf(partsFor('dark'), PAGE, GREY)
  const lone: Scheme = ground && luminance(ground) < luminance(GREY) ? 'dark' : 'light'

  const block = (selector: string, tokens: Record<string, string>) => {
    const lines = Object.entries(tokens).map(([token, value]) => `  ${token}: ${value};`)
    return lines.length ? `${selector} {\n${lines.join('\n')}\n}\n` : ''
  }
  return (stated.length ? stated : [lone])
    .map((scheme) => {
      const parts = partsFor(scheme)
      const worn = block(`:root[data-theme='${scheme}']`, tokensOf(parts, scheme))
      return worn && worn + block(`:root[data-translucent][data-theme='${scheme}']`, glassOf(parts))
    })
    .join('')
}

/** The whole file an import writes: the sheet, and under it what the theme says of
 *  pages, where both fit in what a theme file may be. */
export function ordenTheme(theme: BrowserTheme): string {
  const css = ordenCss(theme)
  const pages = css && paged(theme.pages)
  return css.length + pages.length < MOST ? css + pages : css
}
