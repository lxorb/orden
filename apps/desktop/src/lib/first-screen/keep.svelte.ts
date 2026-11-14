import { documentOf, type EditorView } from '@orden/editor'
import {
  KEY,
  type Kept,
  type Level,
  type Look,
  NAMED,
  RENAMED,
  wordsHash,
} from '../first-screen.svelte'
import { keep } from '../platform/src/api'
import { views } from '../views.svelte'
import { workspace } from '../workspace.svelte'

const QUIET = 1500

const LONGEST = 2_000_000

const LOOKED_AT = [
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'tab-size',
  'padding-left',
  'padding-right',
  'padding-top',
  'width',
]

const DROPPED = new Set(['script', 'style', 'link', 'meta', 'base', 'noscript', 'template'])

const BOXED = new Set(['iframe', 'frame', 'object', 'embed', 'video', 'audio', 'canvas'])

const OWN = /^(?:asset:|https?:\/\/asset\.localhost\/|data:image\/)/i

const ACTING = /^(?:on|contenteditable$|tabindex$|autofocus$|srcdoc$|action$|formaction$|ping$)/i

function inert(live: Element): string {
  const clone = live.cloneNode(true) as Element
  const lives = [live, ...live.querySelectorAll('*')]
  const clones = [clone, ...clone.querySelectorAll('*')]

  clones.forEach((one, at) => {
    const tag = one.localName
    if (DROPPED.has(tag)) {
      one.remove()
      return
    }

    const rect = () => lives[at]?.getBoundingClientRect()
    if (BOXED.has(tag)) {
      const box = one.ownerDocument.createElement('div')
      box.setAttribute('style', sized(one.getAttribute('style'), rect()))
      one.replaceWith(box)
      return
    }

    let taken = false
    for (const { name, value } of [...one.attributes]) {
      if (ACTING.test(name)) one.removeAttribute(name)
      else if (ADDRESSES.test(name) && !allowed(tag, name.toLowerCase(), value.trim())) {
        one.removeAttribute(name)
        taken ||= name.toLowerCase() === 'src'
      } else if (name === 'style') one.setAttribute('style', value.replace(/url\([^)]*\)/gi, own))
    }

    if (taken) one.setAttribute('style', sized(one.getAttribute('style'), rect()))
  })

  return clone.outerHTML
}

const ADDRESSES = /^(?:src|srcset|poster|href|xlink:href)$/i

function allowed(tag: string, name: string, value: string): boolean {
  if (tag === 'a' || name === 'srcset' || name === 'poster') return false
  if (name === 'href' || name === 'xlink:href') {
    return tag === 'use' ? value.startsWith('#') : tag === 'image' && OWN.test(value)
  }
  return OWN.test(value)
}

function own(whole: string): string {
  const inside = whole
    .slice(4, -1)
    .trim()
    .replace(/^['"]|['"]$/g, '')
  return OWN.test(inside) ? whole : 'none'
}

function sized(style: string | null, rect: DOMRect | undefined): string {
  const size = rect ? `width:${String(rect.width)}px;height:${String(rect.height)}px;` : ''
  return `${style ?? ''};display:inline-block;${size}`
}

function levelOf(element: Element): Level {
  const className = [...element.classList]
    .filter((one) => one !== 'cm-focused' && one !== 'rise')
    .join(' ')
  return {
    tag: element.localName,
    className: className.replaceAll(NAMED, RENAMED),
    style: element.getAttribute('style') ?? '',
  }
}

function editorRules(): string {
  const sheets = [
    ...document.adoptedStyleSheets,
    ...[...document.querySelectorAll('style')].flatMap((one) => (one.sheet ? [one.sheet] : [])),
  ]

  const out: string[] = []
  for (const sheet of sheets) {
    const rules = [...sheet.cssRules].map((rule) => rule.cssText)
    if (rules.some((rule) => rule.includes(NAMED))) out.push(...rules)
  }
  return out.join('\n').replaceAll(NAMED, RENAMED)
}

function screenOf(view: EditorView): Kept | null {
  const tab = workspace.active
  const frame = workspace.panes.frame
  if (tab?.kind !== 'note' || tab.reading) return null
  if (frame.kind !== 'pane' || frame.stacked) return null
  if (documentOf(view) !== tab.note.live || view.state.doc.length > LONGEST) return null

  const surface = view.dom.parentElement
  const area = view.dom.closest('.panes')
  if (!surface || !area || view.scrollDOM.querySelector('.cm-gutters')) return null

  const within = area.getBoundingClientRect()
  const outer = surface.getBoundingClientRect()
  const scroller = view.scrollDOM.getBoundingClientRect()
  const content = view.contentDOM.getBoundingClientRect()
  const style = getComputedStyle(view.contentDOM)

  const lines = [...view.contentDOM.children].filter((one) => {
    const rect = one.getBoundingClientRect()
    return rect.bottom > scroller.top && rect.top < scroller.bottom
  })
  const first = lines[0]
  if (!first) return null

  const top = first.getBoundingClientRect().top - parseFloat(getComputedStyle(first).marginTop)
  const atTop = view.lineBlockAtHeight(scroller.top - view.documentTop)
  const look: Look = Object.fromEntries(
    LOOKED_AT.map((name) => [name, style.getPropertyValue(name)]),
  )
  look.left = `${String(Math.round(content.left - outer.left))}px`

  return {
    build: __EVEN_BUILD__,
    path: tab.path,
    words: wordsHash(view.state.doc.toString()),
    area: { width: area.clientWidth, height: area.clientHeight },
    box: {
      left: outer.left - within.left,
      top: outer.top - within.top,
      width: outer.width,
      height: outer.height,
    },
    levels: [surface, view.dom, view.scrollDOM, view.contentDOM].map(levelOf),
    shift: content.top - scroller.top,
    inset: top - content.top - (parseFloat(style.paddingTop) || 0),
    anchor: atTop.from,
    at: atTop.top + view.documentTop - scroller.top,
    lines: lines.map(inert).join('').replaceAll(NAMED, RENAMED),
    css: editorRules(),
    look,
  }
}

let written = ''

function keepScreen(view: EditorView): void {
  const screen = screenOf(view)
  if (!screen) return

  const said = JSON.stringify(screen)
  if (said !== written && keep(KEY, said)) written = said
}

function follow(view: EditorView): () => void {
  let waiting: ReturnType<typeof setTimeout> | undefined
  let idle = 0
  const hasIdle = typeof requestIdleCallback === 'function'

  const later = () => {
    clearTimeout(waiting)
    if (hasIdle) cancelIdleCallback(idle)
    waiting = setTimeout(() => {
      if (hasIdle) idle = requestIdleCallback(() => keepScreen(view), { timeout: QUIET })
      else keepScreen(view)
    }, QUIET)
  }

  const changed = new MutationObserver(later)
  changed.observe(view.contentDOM, { childList: true, subtree: true, characterData: true })
  const resized = new ResizeObserver(later)
  resized.observe(view.scrollDOM)
  view.scrollDOM.addEventListener('scroll', later, { passive: true })

  const hidden = () => {
    if (document.visibilityState === 'hidden') keepScreen(view)
  }
  const leaving = () => keepScreen(view)
  document.addEventListener('visibilitychange', hidden)
  addEventListener('pagehide', leaving)

  later()
  return () => {
    clearTimeout(waiting)
    if (hasIdle) cancelIdleCallback(idle)
    changed.disconnect()
    resized.disconnect()
    view.scrollDOM.removeEventListener('scroll', later)
    document.removeEventListener('visibilitychange', hidden)
    removeEventListener('pagehide', leaving)
  }
}

export function keepFirstScreens(): void {
  $effect.root(() => {
    $effect(() => {
      const view = views.of(workspace.panes.focusedId)
      if (!view || workspace.active?.kind !== 'note') return
      return follow(view)
    })
  })
}
