import { code, totpIn } from '@orden/pass/totp'
import type { Content } from '@orden/pass/types'
import type { LinkOpened } from '@orden/pass/wire'
import { isPassId, linkOpenedIn } from '@orden/pass/wire'
import type { LinkField } from './link-fields'
import { kindName, linkGroupsOf, websitesOf } from './link-fields'
import { LINK_PATH, linkKeyIn, OPEN_PATH, openedLink } from './link-seal'

export interface LinkWorld {
  location: Pick<Location, 'pathname' | 'search' | 'hash'>
  history: Pick<History, 'replaceState'>
  fetch(url: string, init?: RequestInit): Promise<Response>
  clipboard: Pick<Clipboard, 'writeText'> | null
  now(): number
}

export type LinkShown = 'incomplete' | 'missing' | 'gone' | 'busy' | 'offline' | 'broken' | 'open'

const SAID: Record<Exclude<LinkShown, 'open'>, { head: string; body: string }> = {
  incomplete: {
    head: 'This link is incomplete',
    body: 'Ask for the whole link again, including everything after the #.',
  },
  missing: {
    head: 'There is no such link',
    body: 'It may have been deleted by the person who shared it.',
  },
  gone: {
    head: 'This link has expired',
    body: 'It was open for a limited time or a limited number of views, and that is used up.',
  },
  busy: {
    head: 'Too many links were opened from here',
    body: 'Try again in an hour.',
  },
  offline: {
    head: 'Orden could not be reached',
    body: 'Check the connection and reload the page.',
  },
  broken: {
    head: 'This link could not be opened',
    body: 'The link may have been copied wrong. Ask for it again.',
  },
}

const MASK = '••••••••••••'
const COPIED_FOR = 1500

function made<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

function said(root: HTMLElement, shown: Exclude<LinkShown, 'open'>): LinkShown {
  const box = made('section', 'link-said')
  box.dataset.shown = shown
  box.append(made('h1', 'link-title', SAID[shown].head), made('p', 'link-muted', SAID[shown].body))
  root.replaceChildren(box)
  return shown
}

function copyButton(world: LinkWorld, value: () => string): HTMLButtonElement {
  const button = made('button', 'link-button', 'Copy')
  button.type = 'button'
  button.addEventListener('click', () => {
    void world.clipboard?.writeText(value()).then(() => {
      button.textContent = 'Copied'
      setTimeout(() => {
        button.textContent = 'Copy'
      }, COPIED_FOR)
    })
  })
  return button
}

function totpRow(world: LinkWorld, field: LinkField, value: HTMLElement): () => string {
  const totp = totpIn(field.value)
  if (totp === null) {
    value.textContent = field.value
    return () => field.value
  }
  let current = ''
  const tick = () => {
    if (!value.isConnected && current !== '') {
      clearInterval(timer)
      return
    }
    void code(totp, world.now()).then((one) => {
      current = one.code
      value.textContent = `${one.code.slice(0, 3)} ${one.code.slice(3)}`
      value.dataset.remaining = String(one.remaining)
    })
  }
  const timer = setInterval(tick, 1000)
  tick()
  return () => current
}

function fieldRow(world: LinkWorld, field: LinkField): HTMLElement {
  const row = made('div', 'link-field')
  row.dataset.field = field.id
  const text = made('div', 'link-field-text')
  const value = made(field.kind === 'long' ? 'pre' : 'div', 'link-value')
  text.append(made('div', 'link-name', field.name), value)
  const actions = made('div', 'link-actions')
  let read = () => field.value
  if (field.kind === 'totp') {
    read = totpRow(world, field, value)
  } else if (field.kind === 'hidden') {
    value.textContent = MASK
    value.classList.add('link-hidden')
    const show = made('button', 'link-button', 'Show')
    show.type = 'button'
    show.addEventListener('click', () => {
      const hidden = value.classList.toggle('link-hidden')
      value.textContent = hidden ? MASK : field.value
      show.textContent = hidden ? 'Show' : 'Hide'
    })
    actions.append(show)
  } else {
    value.textContent = field.value
  }
  actions.append(copyButton(world, () => read()))
  row.append(text, actions)
  return row
}

function whenText(opened: LinkOpened): string {
  const day = new Date(opened.expires).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  const views =
    opened.left === null
      ? ''
      : opened.left === 0
        ? ' This was the last view.'
        : ` ${String(opened.left)} ${opened.left === 1 ? 'view' : 'views'} left.`
  return `Expires ${day}.${views}`
}

function shownItem(
  root: HTMLElement,
  world: LinkWorld,
  content: Content,
  opened: LinkOpened,
): LinkShown {
  const card = made('article', 'link-card')
  const head = made('header', 'link-head')
  head.append(
    made('div', 'link-kind', kindName(content.kind)),
    made('h1', 'link-title', content.title || 'Untitled'),
  )
  card.append(head)
  for (const group of linkGroupsOf(content)) {
    const box = made('section', 'link-group')
    if (group.name) box.append(made('h2', 'link-group-name', group.name))
    for (const one of group.fields) box.append(fieldRow(world, one))
    card.append(box)
  }
  const websites = websitesOf(content)
  if (websites.length) {
    const box = made('section', 'link-group')
    box.append(made('h2', 'link-group-name', 'Websites'))
    for (const url of websites) box.append(made('div', 'link-value link-site', url))
    card.append(box)
  }
  if (content.note.trim()) {
    const box = made('section', 'link-group')
    box.append(made('h2', 'link-group-name', 'Note'), made('pre', 'link-note', content.note))
    card.append(box)
  }
  const foot = made('footer', 'link-foot')
  foot.append(made('p', 'link-muted link-when', whenText(opened)))
  card.append(foot)
  root.replaceChildren(card)
  return 'open'
}

export function linkIdOf(pathname: string): string | null {
  if (!pathname.startsWith(LINK_PATH)) return null
  const id = pathname.slice(LINK_PATH.length).replace(/\/+$/, '')
  return isPassId(id) ? id : null
}

async function answerOf(world: LinkWorld, id: string): Promise<Response | null> {
  try {
    return await world.fetch(`${OPEN_PATH}${encodeURIComponent(id)}`, {
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
  } catch {
    return null
  }
}

const TRY_AGAIN: ReadonlySet<LinkShown> = new Set(['offline', 'busy'])

export async function shownLink(root: HTMLElement, world: LinkWorld): Promise<LinkShown> {
  const { pathname, search, hash } = world.location
  const shown = await linkShown(root, world, pathname, hash)
  if (hash !== '' && !TRY_AGAIN.has(shown)) {
    world.history.replaceState(null, '', `${pathname}${search}`)
  }
  return shown
}

async function linkShown(
  root: HTMLElement,
  world: LinkWorld,
  pathname: string,
  hash: string,
): Promise<LinkShown> {
  const id = linkIdOf(pathname)
  const key = linkKeyIn(hash)
  if (id === null || key === null) return said(root, 'incomplete')
  const answer = await answerOf(world, id)
  if (answer === null) return said(root, 'offline')
  if (answer.status === 404) return said(root, 'missing')
  if (answer.status === 410) return said(root, 'gone')
  if (answer.status === 429) return said(root, 'busy')
  if (!answer.ok) return said(root, 'offline')
  const opened = linkOpenedIn(await answer.json().catch(() => null))
  const content = opened ? await openedLink(key, id, opened.body) : null
  if (!opened || !content) return said(root, 'broken')
  return shownItem(root, world, content, opened)
}
