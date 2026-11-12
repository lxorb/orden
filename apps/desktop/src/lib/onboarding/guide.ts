import type { Coding } from './flow'

export type Target = 'sidebar' | 'note' | 'tasks' | 'list' | 'tabs'

export interface Card {
  at: Target
  title: string
  text: string
}

export interface Came {
  notes: { id: string; name: string } | null
  browser: string | null
  ai: boolean
  code: Coding
  terminals: boolean
}

const MARKDOWN_LIKE: ReadonlySet<string> = new Set([
  'obsidian',
  'markdown',
  'logseq',
  'bear',
  'roam',
  'notion',
])

const MOST = 5

function brought(app: { id: string; name: string }): Card {
  if (app.id === 'notion') {
    return {
      at: 'note',
      title: `Your ${app.name} pages are here`,
      text: 'Pages became notes, and databases became bases with their views.',
    }
  }
  return {
    at: 'note',
    title: `Your ${app.name} notes are here`,
    text: MARKDOWN_LIKE.has(app.id)
      ? 'Still plain Markdown files, and your links work like before.'
      : 'Every note is a file you own.',
  }
}

export function guideCards(came: Came): Card[] {
  const cards: Card[] = [
    {
      at: 'sidebar',
      title: 'Everything lives in one space',
      text: 'Notes, to-dos, web pages and chats sit side by side, so you never lose track.',
    },
  ]
  if (came.notes) cards.push(brought(came.notes))
  cards.push(
    came.notes && MARKDOWN_LIKE.has(came.notes.id)
      ? {
          at: 'tasks',
          title: 'More than Markdown',
          text: 'To-dos, bases and boards live right inside your notes. Today shows what is due.',
        }
      : {
          at: 'tasks',
          title: 'To-dos in any note',
          text: 'Write a to-do anywhere. Today collects everything that is due.',
        },
  )
  cards.push(
    came.browser
      ? {
          at: 'list',
          title: `Your ${came.browser} bookmarks`,
          text: 'They are in the sidebar. Web pages open as tabs next to your notes.',
        }
      : {
          at: 'tabs',
          title: 'Web pages are tabs',
          text: 'Browse next to your notes, without switching apps.',
        },
  )
  if (came.ai) {
    cards.push({
      at: 'tabs',
      title: 'Ask your AI',
      text: 'Chats sit next to your notes and can use what is in your space.',
    })
  } else if (came.code === 'yes' && came.terminals) {
    cards.push({
      at: 'tabs',
      title: 'Terminals are tabs too',
      text: 'Open one next to the notes for your project.',
    })
  }
  return cards.slice(0, MOST)
}

export function targetOf(at: Target): Element | null {
  const list = document.querySelector('[data-region="list"]')
  switch (at) {
    case 'sidebar':
      return list?.closest('aside') ?? null
    case 'list':
      return list
    case 'tasks':
      return (
        document.querySelector('[data-region="panels"] [data-tab="tasks"]') ??
        document.querySelector('[data-region="panels"]')
      )
    case 'tabs':
      return document.querySelector('[data-region="tabs"]')
    case 'note': {
      const editor = document.querySelector('[data-region="editor"]')
      return editor?.querySelector('h1, .cm-line') ?? editor
    }
  }
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export function shownBox(found: Element | null, room: { width: number; height: number }) {
  if (!found) return null
  const box = found.getBoundingClientRect()
  if (box.width < 1 || box.height < 1) return null
  if (box.right <= 0 || box.bottom <= 0 || box.left >= room.width || box.top >= room.height)
    return null
  return { x: box.left, y: box.top, width: box.width, height: box.height }
}

const PAD = 8
const GAP = 14
const EDGE = 16

export function placeCard(
  target: Box | null,
  card: { width: number; height: number },
  room: { width: number; height: number },
): { spot: Box | null; left: number; top: number } {
  if (!target) {
    return {
      spot: null,
      left: (room.width - card.width) / 2,
      top: (room.height - card.height) / 2,
    }
  }
  const spot = {
    x: target.x - PAD,
    y: target.y - PAD,
    width: Math.min(target.width + PAD * 2, room.width - EDGE),
    height: Math.min(target.height + PAD * 2, room.height - 120),
  }
  let left: number
  let top: number
  if (spot.x + spot.width + GAP + card.width < room.width - EDGE) {
    left = spot.x + spot.width + GAP
    top = spot.y + Math.min(24, spot.height / 2)
  } else if (spot.y + spot.height + GAP + card.height < room.height - EDGE) {
    left = spot.x + 24
    top = spot.y + spot.height + GAP
  } else {
    left = spot.x + spot.width - card.width - 24
    top = spot.y + 24
  }
  return {
    spot,
    left: Math.max(EDGE, Math.min(left, room.width - card.width - EDGE)),
    top: Math.max(EDGE, Math.min(top, room.height - card.height - EDGE)),
  }
}
