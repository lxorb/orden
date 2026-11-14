import { webPages } from '@orden/contracts'
import { glassCss } from '@orden/themes/glass'
import { untrack } from 'svelte'
import { accentColour, theme, chrome, type Ground } from '../../../theme/src/api'
import {
  hexOf,
  type Rgb,
  rgbOf,
  alphaFor,
  layered,
  linkOf,
  type PaperInks,
} from '../../../ui-controls/src/api'
import { isDesktop } from '../../../platform/src/api'
import { paletteOf } from '../wallpaper/floors'
import { workspace } from '../../../workspace.svelte'
import { dominant } from './colours'
import { grounds } from './grounds.svelte'
import { pixelsOf } from './pictures'
import { groundOf } from './reading'
import { contentOf } from '../translucent-settings'
import { PAPER, schemeTokens } from '../scheme-tokens'
import { dialsOf, glassValues } from './settings'
import { type Stops, stopsOf } from './pairs'
import { barFor, frameFor, type Material, pairFor, type Sides, type Source } from './tint'

const SETTLES = 250

const LATER = 1500

const MARK = { width: 24, height: 24 }

const SIDES: Sides | null = (() => {
  const names = { scrim: '--glass-chrome', layer: '--glass-layer' }
  const dark = paletteOf(glassCss, 'dark', names)
  const light = paletteOf(glassCss, 'light', names)
  return dark && light ? { dark, light } : null
})()

const marks = $state<Record<string, string | null>>({})
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping nothing draws
const asking = new Set<string>()

function markColour(src: string | null): Rgb | null {
  if (!src) return null
  const said = marks[src]
  if (said !== undefined) return said === null ? null : rgbOf(said)
  if (!asking.has(src)) {
    asking.add(src)
    void pixelsOf(src, MARK).then((pixels) => {
      const colour = pixels ? dominant(pixels) : null
      marks[src] = colour ? hexOf(colour) : null
    })
  }
  return null
}

function materialOf(said: string | null): Material {
  return said === 'mica' || said === 'acrylic' || said === 'clear' ? said : null
}

function paper(): Rgb {
  const said = getComputedStyle(document.documentElement).getPropertyValue('--bg')
  return rgbOf(said) ?? (chrome.app === 'dark' ? [14, 16, 19] : [251, 252, 253])
}

function addressOf(tab: string, written: string | undefined): string | null {
  return webPages().addressOf(tab) ?? written ?? null
}

function groundNow(tab: string, address: string | null): Rgb | null {
  return grounds.of(tab, address) ?? (webPages().loadingOf(tab) ? grounds.last(tab) : null)
}

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping nothing draws
const waiting = new Map<string, ReturnType<typeof setTimeout>>()
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping nothing draws
const askedFor = new Set<string>()

function askOnce(tab: string, address: string | null): void {
  const key = `${tab} ${address ?? ''}`
  if (askedFor.has(key)) return
  askedFor.add(key)
  landed(tab)
}

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping nothing draws
const inked = new Map<string, PaperInks>()
function inksOf(sides: Sides): PaperInks {
  const app = chrome.app
  const key = `${app} ${theme.accent}`
  const held = inked.get(key)
  if (held) return held
  const side = sides[app]
  const read = schemeTokens(app, ['--bg', '--text-strong'])
  const accent = rgbOf(accentColour(theme.accent, app)) ?? side.text
  const inks = {
    bg: read['--bg'] ?? PAPER[app],
    text: side.text,
    muted: side.ink,
    link: linkOf(accent, read['--text-strong'] ?? side.text),
  }
  inked.set(key, inks)
  return inks
}

function sourceOf(sides: Sides): Source | Stops {
  const tab = workspace.active
  const values = glassValues()
  const pair = () => stopsOf(values.pair, chrome.app, theme.accent, sides.dark.scrim)
  if (values.follow === false) return pair()

  if (tab?.kind === 'web') {
    const address = addressOf(tab.id, tab.address)
    const page = webPages().of(tab.id)
    if (isDesktop && !page.loading && !grounds.heard(tab.id, address)) askOnce(tab.id, address)

    const ground = groundNow(tab.id, address)
    if (ground) return { colour: ground, page: true }

    const mark = markColour(page.icon ?? webPages().faviconOf(address))
    if (mark) return { colour: mark, page: false }
  }

  return pair()
}

function barsOf(sides: Sides): Record<string, Ground> {
  const bars: Record<string, Ground> = {}
  if (glassValues().tab === false) return bars
  for (const tab of workspace.tabs) {
    if (tab.kind !== 'web') continue
    const ground = groundNow(tab.id, addressOf(tab.id, tab.address))
    if (ground) bars[tab.id] = barFor(ground, chrome.app, sides)
  }
  return bars
}

let stop: (() => void) | null = null

export function follow(): void {
  if (stop || !SIDES) return
  const sides = SIDES

  for (const tab of webPages().tabs()) landed(tab)

  stop = $effect.root(() => {
    $effect(() => {
      if (!chrome.on) return
      const material = materialOf(chrome.material)
      const source = sourceOf(sides)
      const around = [
        chrome.app,
        material,
        sides,
        paper(),
        dialsOf(glassValues()),
        material ? inksOf(sides) : null,
      ] as const
      const frame = 'page' in source ? frameFor(source, ...around) : pairFor(source, ...around)
      const level = material ? contentOf(glassValues().content) : 'opaque'
      const laid = alphaFor(level, frame.paper)
      const worn = {
        scheme: frame.scheme,
        tint: frame.tint,
        ...(frame.second ? { second: frame.second } : {}),
        wash: frame.wash,
        paper: laid,
        terminal: layered(alphaFor(level, frame.terminal), laid),
      }
      const bars = barsOf(sides)
      const tab = workspace.active?.id ?? null
      untrack(() => {
        chrome.floor = frame.floor
        chrome.wear(worn, bars, tab)
      })
    })
  })
}

function read(tab: string, again: boolean): void {
  if (!chrome.on) return
  const written = workspace.tabs.find((one) => one.id === tab)?.address
  void groundOf(tab).then((ground) => {
    if (ground === undefined) return
    grounds.said(tab, addressOf(tab, written), ground)
    if (again) {
      setTimeout(() => {
        if (!waiting.has(tab)) read(tab, false)
      }, LATER)
    }
  })
}

export function landed(tab: string): void {
  clearTimeout(waiting.get(tab))
  waiting.set(
    tab,
    setTimeout(() => {
      waiting.delete(tab)
      read(tab, true)
    }, SETTLES),
  )
}
