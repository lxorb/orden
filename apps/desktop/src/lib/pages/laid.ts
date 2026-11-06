import type { CanvasNode } from '../canvas/format'

export interface Run {
  text: string
  x: number
  y: number
  width: number
  size: number
  family: string
  weight: number
  italic: boolean
  mono: boolean
  colour: string
}

export type TextCard = CanvasNode & { type: 'text' }

export async function laidOut(
  cards: readonly TextCard[],
  context: { path: string | null; root: string | null; trusted: boolean },
): Promise<Map<string, Run[]>> {
  const laid = new Map<string, Run[]>()
  if (!cards.length || typeof document === 'undefined') return laid

  const [{ mount, tick, unmount }, { default: Card }] = await Promise.all([
    import('svelte'),
    import('../CanvasNode.svelte'),
  ])

  const stage = document.createElement('div')
  stage.dataset.theme = 'light'
  stage.setAttribute('aria-hidden', 'true')
  stage.style.cssText =
    'position:fixed;left:-100000px;top:0;width:0;height:0;visibility:hidden;pointer-events:none'
  document.body.append(stage)

  const mounted: { card: TextCard; host: HTMLElement; done: () => void }[] = []
  try {
    for (const card of cards) {
      const host = document.createElement('div')
      host.style.cssText = 'position:absolute;left:0;top:0'
      stage.append(host)
      const component = mount(Card, {
        target: host,
        props: {
          node: { ...card, x: 0, y: 0 },
          canvasPath: context.path,
          trusted: context.trusted,
          root: context.root,
          picked: false,
          editing: false,
          readOnly: true,
          offset: { x: 0, y: 0 },
        },
      })
      mounted.push({ card, host, done: () => void unmount(component) })
    }

    await tick()
    await document.fonts.ready
    await new Promise((done) => requestAnimationFrame(() => done(null)))

    for (const { card, host } of mounted) laid.set(card.id, runsOf(host))
  } finally {
    for (const one of mounted) one.done()
    stage.remove()
  }

  return laid
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function runsOf(host: HTMLElement): Run[] {
  const node = host.querySelector<HTMLElement>('.node')
  const card = node?.querySelector<HTMLElement>('.card')
  if (!node || !card) return []

  const origin = node.getBoundingClientRect()
  const runs: Run[] = []
  const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT)
  const range = document.createRange()

  for (let text = walker.nextNode() as Text | null; text; text = walker.nextNode() as Text | null) {
    const parent = text.parentElement
    if (!parent || !text.data.trim()) continue

    const style = getComputedStyle(parent)
    const size = Number.parseFloat(style.fontSize)
    const font = {
      size,
      family: style.fontFamily,
      weight: Number.parseInt(style.fontWeight, 10) || 400,
      italic: style.fontStyle === 'italic' || style.fontStyle.startsWith('oblique'),
      mono: /mono|courier|consolas|menlo/i.test(style.fontFamily),
      colour: style.color,
    }
    const ascent = ascentOf(style)

    let run: {
      text: string
      left: number
      right: number
      top: number
      start: number
      end: number
    } | null = null
    const close = () => {
      if (run?.text.trim()) {
        runs.push({
          ...font,
          text: inContext(run.text.replace(/\s+/g, ' ').trim(), text.data, run.start, run.end),
          x: run.left - origin.left,
          y: run.top - origin.top + ascent,
          width: run.right - run.left,
        })
      }
      run = null
    }

    for (const one of graphemes.segment(text.data)) {
      range.setStart(text, one.index)
      range.setEnd(text, one.index + one.segment.length)
      const rects = Array.from(range.getClientRects()).filter((r) => r.width || r.height)
      const rect = rects[rects.length - 1]
      if (!rect) continue
      if (rect.top > origin.bottom) break

      const blank = !one.segment.trim()
      if (run && Math.abs(rect.top - run.top) > size / 2) close()
      if (!run) {
        if (blank) continue
        run = {
          text: '',
          left: rect.left,
          right: rect.right,
          top: rect.top,
          start: one.index,
          end: one.index,
        }
      }
      run.text += one.segment
      run.end = one.index + one.segment.length
      if (!blank) {
        run.left = Math.min(run.left, rect.left)
        run.right = Math.max(run.right, rect.right)
        run.top = Math.min(run.top, rect.top)
      }
    }
    close()
  }

  return [...runs, ...markersOf(card, origin)]
}

const RTL = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u
const LETTER = /\p{L}/u

function rtlAt(text: string, last: boolean): boolean | null {
  const letters = Array.from(text).filter((one) => LETTER.test(one))
  const one = last ? letters[letters.length - 1] : letters[0]
  return one === undefined ? null : RTL.test(one)
}

function inContext(run: string, paragraph: string, start: number, end: number): string {
  const rlm = '\u200f'
  let out = run
  if (/\P{L}$/u.test(run) && rtlAt(run, true) && rtlAt(paragraph.slice(end), false)) out += rlm
  if (/^\P{L}/u.test(run) && rtlAt(run, false) && rtlAt(paragraph.slice(0, start), true)) {
    out = rlm + out
  }
  return out
}

let measuring: CanvasRenderingContext2D | null | undefined

function ascentOf(style: CSSStyleDeclaration): number {
  measuring ??= document.createElement('canvas').getContext('2d')
  const size = Number.parseFloat(style.fontSize)
  if (!measuring) return size * 0.8

  measuring.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  const ascent = measuring.measureText('Hg').fontBoundingBoxAscent
  return Number.isFinite(ascent) && ascent > 0 ? ascent : size * 0.8
}

function markersOf(card: HTMLElement, origin: DOMRect): Run[] {
  const runs: Run[] = []

  for (const item of Array.from(card.querySelectorAll('li'))) {
    const list = item.parentElement
    const first = item.firstChild ? firstLine(item) : null
    if (!list || !first) continue

    const style = getComputedStyle(item)
    const size = Number.parseFloat(style.fontSize)
    const ordered = list.tagName === 'OL'
    const start = list instanceof HTMLOListElement ? list.start : 1
    const text = ordered ? `${start + Array.from(list.children).indexOf(item)}.` : '•'
    const width = text.length * size * 0.55
    runs.push({
      text,
      x: first.left - origin.left - size * 0.5 - width,
      y: first.top - origin.top + ascentOf(style),
      width,
      size,
      family: style.fontFamily,
      weight: Number.parseInt(style.fontWeight, 10) || 400,
      italic: false,
      mono: false,
      colour: style.color,
    })
  }

  return runs
}

function firstLine(element: Element): DOMRect | null {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  for (let text = walker.nextNode() as Text | null; text; text = walker.nextNode() as Text | null) {
    const at = text.data.search(/\S/)
    if (at < 0) continue
    range.setStart(text, at)
    range.setEnd(text, at + 1)
    const rect = range.getClientRects()[0]
    if (rect) return rect
  }
  return null
}

export function localFaces(): string {
  if (typeof document === 'undefined') return ''
  const faces: string[] = []

  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue
      const source = rule.style.getPropertyValue('src')
      if (source && !/url\(/i.test(source)) faces.push(rule.cssText)
    }
  }

  return faces.join('')
}
