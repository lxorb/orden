import { hexOf } from '../../../ui-controls/src/api'
import { invoke, isDesktop } from '../../../platform/src/api'
import { webPages } from '@orden/contracts'
import { groundSaid, type PageSaid, stripGround } from './colours'
import { pixelsOf } from './pictures'

const ANSWERS = 800

const STRIP = { rows: 6, width: 48, height: 2 }

function painter(doc: Document): (colour: string) => string {
  const paint = doc.createElement('canvas').getContext('2d')
  return (colour) => {
    if (!paint || !colour) return ''
    paint.fillStyle = '#000000'
    paint.fillStyle = colour
    const first = paint.fillStyle
    paint.fillStyle = '#ffffff'
    paint.fillStyle = colour
    return first === paint.fillStyle ? first : ''
  }
}

const PICTURES = /^(img|video|canvas|iframe|picture|svg|embed|object)$/i

function readFrame(win: Window): PageSaid {
  const doc = win.document
  const said = painter(doc)

  let theme = ''
  for (const one of doc.querySelectorAll('meta[name="theme-color" i]')) {
    const media = one.getAttribute('media')
    if (media && !win.matchMedia(media).matches) continue
    theme = said(one.getAttribute('content') ?? '')
    if (theme) break
  }

  const root = doc.documentElement
  const wide = root.clientWidth || win.innerWidth
  const scheme = win.getComputedStyle(root).colorScheme || ''
  const dark =
    scheme.includes('dark') &&
    (!scheme.includes('light') || win.matchMedia('(prefers-color-scheme: dark)').matches)

  const top: string[] = []
  let pictured = false
  for (const point of [0.08, 0.5, 0.92]) {
    let found = ''
    let here = false
    for (
      let one: Element | null = doc.elementFromPoint(Math.round(wide * point), 1);
      one;
      one = one.parentElement
    ) {
      const style = win.getComputedStyle(one)
      if (
        PICTURES.test(one.tagName) ||
        (style.backgroundImage && style.backgroundImage !== 'none')
      ) {
        here = true
        break
      }
      const ground = said(style.backgroundColor)
      if (ground.startsWith('#')) {
        found = ground
        break
      }
    }
    pictured ||= here
    top.push(found || (here ? '' : dark ? '#121212' : '#ffffff'))
  }

  return { theme, top, pictured }
}

async function asked(tab: string): Promise<PageSaid | null> {
  if (isDesktop) {
    return Promise.race([
      invoke<PageSaid>('web_tint', { tab }).catch(() => null),
      new Promise<null>((go) => setTimeout(() => go(null), ANSWERS)),
    ])
  }

  const frame = document.querySelector<HTMLIFrameElement>(
    `iframe[data-web-tab="${CSS.escape(tab)}"]`,
  )
  try {
    return frame?.contentWindow ? readFrame(frame.contentWindow) : null
  } catch {
    return null
  }
}

async function fromStill(tab: string): Promise<string | null> {
  await webPages().shoot(tab)
  const still = webPages().of(tab).shot
  if (!still) return null

  const pixels = await pixelsOf(still, STRIP)
  const ground = pixels ? stripGround(pixels) : null
  return ground ? hexOf(ground) : null
}

export async function groundOf(tab: string): Promise<string | null | undefined> {
  const said = await asked(tab)
  if (!said) return undefined

  const ground = groundSaid(said)
  if (ground) return hexOf(ground)
  return isDesktop ? fromStill(tab) : null
}
