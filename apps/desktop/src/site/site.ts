import { framing, nodeAt } from '../lib/camera'
import type { NoteGraph } from '../lib/graph'
import { neighbours } from '../lib/graph-walk'
import { Layout } from '../lib/graph-layout'
import { paint, radiusOf } from '../lib/graph-paint'

const THEME_KEY = 'orden:site-theme'

const OLD_THEME_KEY = 'nib:site-theme'

const HOVER_IN = 320
const HOVER_OUT = 180

const MOST_CACHED = 40

function ready(run: () => void) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run)
  else run()
}

function slashFocuses() {
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return

    const inside = event.target as HTMLElement | null
    if (inside?.closest('input, textarea, select, [contenteditable]')) return

    const box = document.querySelector<HTMLInputElement>('.find input[name="q"]')
    if (!box) return

    event.preventDefault()
    box.focus()
    box.select()
  })
}

function themeToggle() {
  const button = document.querySelector<HTMLButtonElement>('.theme')
  if (!button) return

  const order = ['system', 'light', 'dark'] as const
  const say = (held: string) => {
    button.dataset.theme = held
    button.setAttribute(
      'aria-label',
      held === 'system' ? 'Theme: follow the system' : `Theme: ${held}`,
    )
  }

  let held = (() => {
    try {
      return localStorage.getItem(THEME_KEY) ?? localStorage.getItem(OLD_THEME_KEY) ?? 'system'
    } catch {
      return 'system'
    }
  })()

  say(held)

  button.addEventListener('click', () => {
    held = order[(order.indexOf(held as 'system') + 1) % order.length] ?? 'system'

    if (held === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', held)

    try {
      if (held === 'system') localStorage.removeItem(THEME_KEY)
      else localStorage.setItem(THEME_KEY, held)
      localStorage.removeItem(OLD_THEME_KEY)
    } catch {
      // Nothing to do and nobody to tell.
    }

    say(held)
  })
}

const held = new Map<string, string>()

async function preview(href: string): Promise<string | null> {
  const kept = held.get(href)
  if (kept !== undefined) return kept

  try {
    const answer = await fetch(href, { headers: { 'x-orden-preview': '1' } })
    if (!answer.ok) return null

    const page = new DOMParser().parseFromString(await answer.text(), 'text/html')
    const write = page.querySelector('#write')
    if (!write) return null

    for (const gone of write.querySelectorAll('nav, footer, .back, .present, .find, .toc')) {
      gone.remove()
    }

    const words = write.innerHTML.slice(0, 4000)
    if (held.size >= MOST_CACHED) held.delete([...held.keys()][0] ?? '')
    held.set(href, words)

    return words
  } catch {
    return null
  }
}

function hoverCards() {
  const card = document.createElement('aside')
  card.className = 'card'
  card.hidden = true
  document.body.append(card)

  let going: ReturnType<typeof setTimeout> | undefined
  let leaving: ReturnType<typeof setTimeout> | undefined

  const place = (link: HTMLAnchorElement) => {
    const box = link.getBoundingClientRect()
    const room = window.innerHeight - box.bottom
    card.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - 380))}px`

    if (room > 260) {
      card.style.top = `${box.bottom + 8}px`
      card.style.bottom = 'auto'
    } else {
      card.style.bottom = `${window.innerHeight - box.top + 8}px`
      card.style.top = 'auto'
    }
  }

  const show = async (link: HTMLAnchorElement) => {
    const words = await preview(link.pathname)
    if (!words) return

    card.innerHTML = words
    card.hidden = false
    place(link)
  }

  const hide = () => {
    clearTimeout(going)
    leaving = setTimeout(() => (card.hidden = true), HOVER_OUT)
  }

  const inside = (target: EventTarget | null): HTMLAnchorElement | null => {
    const link = (target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href^="/"]')
    if (!link || link.getAttribute('href')?.startsWith('/i/')) return null
    if (link.pathname === location.pathname) return null

    return link
  }

  document.addEventListener('pointerover', (event) => {
    const link = inside(event.target)
    if (!link) return

    clearTimeout(leaving)
    clearTimeout(going)
    going = setTimeout(() => void show(link), HOVER_IN)
  })

  document.addEventListener('pointerout', (event) => {
    if (inside(event.target)) hide()
  })

  document.addEventListener(
    'contextmenu',
    (event) => {
      const link = inside(event.target)
      if (!link || !window.matchMedia('(hover: none)').matches) return

      event.preventDefault()
      void show(link)
    },
    { passive: false },
  )

  card.addEventListener('pointerenter', () => clearTimeout(leaving))
  card.addEventListener('pointerleave', hide)
  document.addEventListener('scroll', () => (card.hidden = true), { passive: true })
}

function graphs() {
  for (const holder of document.querySelectorAll<HTMLElement>('.graph')) {
    const said = holder.querySelector('script[type="application/json"]')?.textContent
    if (!said) continue

    let graph: NoteGraph
    try {
      graph = JSON.parse(said) as NoteGraph
    } catch {
      continue
    }
    if (!graph.nodes.length) continue

    const canvas = document.createElement('canvas')
    holder.append(canvas)

    const context = canvas.getContext('2d')
    if (!context) continue

    const count = graph.nodes.length
    const layout = new Layout(graph)
    const radii = new Float64Array(count)
    for (let one = 0; one < count; one++) radii[one] = radiusOf(graph.nodes[one]?.degree ?? 0)

    const lit = new Uint8Array(count)
    const shown = new Uint8Array(count).fill(1)
    const tint = new Int8Array(count).fill(-1)

    const style = getComputedStyle(holder)
    const token = (name: string) => style.getPropertyValue(name).trim()
    const colours = {
      edge: token('--line-strong') || '#33333b',
      litEdge: token('--accent') || '#6f5ce0',
      node: token('--muted') || '#8a8a94',
      hollow: token('--muted') || '#8a8a94',
      current: token('--accent') || '#6f5ce0',
      label: token('--muted-strong') || '#b6b6c0',
      font: token('--font-ui') || 'sans-serif',
      groups: [],
    }

    const current = graph.nodes.findIndex((one) => one.path === holder.dataset.here)
    let hovered = -1
    let width = 0
    let height = 0
    let ratio = 1
    let camera = { x: 0, y: 0, scale: 1 }

    const size = () => {
      const box = holder.getBoundingClientRect()
      width = box.width
      height = box.height
      ratio = window.devicePixelRatio || 1

      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }

    const draw = () => {
      context.clearRect(0, 0, width, height)
      paint(context, {
        graph,
        x: layout.x,
        y: layout.y,
        radii,
        camera,
        width,
        height,
        colours,
        current,
        hovered,
        lit,
        shown,
        tint,
        arrows: false,
        lines: 2,
        fade: 1,
        ratio,
      })
    }

    const settle = () => {
      const done = layout.settle(12)
      camera = framing(layout.x, layout.y, count, width, height, 28)
      draw()

      if (!done) requestAnimationFrame(settle)
    }

    size()
    settle()

    window.addEventListener(
      'resize',
      () => {
        size()
        camera = framing(layout.x, layout.y, count, width, height, 28)
        draw()
      },
      { passive: true },
    )

    canvas.addEventListener('pointermove', (event) => {
      const box = canvas.getBoundingClientRect()
      const at = nodeAt(
        layout.x,
        layout.y,
        radii,
        camera,
        width,
        height,
        event.clientX - box.left,
        event.clientY - box.top,
      )

      if (at === hovered) return
      hovered = at

      lit.fill(0)
      if (at >= 0) {
        lit[at] = 2
        for (const near of neighbours(graph, at)) lit[near] ||= 1
      }

      canvas.style.cursor = at >= 0 && graph.nodes[at]?.path ? 'pointer' : 'default'
      draw()
    })

    canvas.addEventListener('pointerleave', () => {
      hovered = -1
      lit.fill(0)
      draw()
    })

    canvas.addEventListener('click', () => {
      const where = hovered >= 0 ? graph.nodes[hovered]?.path : null
      if (where) location.assign(where)
    })
  }
}

ready(() => {
  slashFocuses()
  themeToggle()
  hoverCards()
  graphs()
})
