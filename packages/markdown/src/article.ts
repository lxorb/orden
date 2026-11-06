import { Readability } from '@mozilla/readability'
import { absolute, runsCode } from './addresses'
import type { ClipOrigin } from './clip-note'
import { formSays, NEVER } from './from-html'
import { SELECTED } from './snapshot'

export type ClipKind = ClipOrigin['kind']

const CONTROLS = ['.mw-editsection', '.editsection']

const NOT_CONTENT = [
  ...NEVER,
  'input:not([type="checkbox"])',
  '[aria-hidden="true"]',
  ...CONTROLS,
].join(',')

export type Origin = ClipOrigin

export interface Source extends Origin {
  html: string
}

const LAZY = ['data-src', 'data-original', 'data-lazy-src', 'data-actualsrc']

function isPlaceholder(src: string): boolean {
  return !src || src.startsWith('data:')
}

const CANDIDATE = /[\s,]*([^\s,](?:\S*[^\s,])?)(?:\s+([^,]*))?/g

export function widestOf(srcset: string): string | null {
  let best: { url: string; weight: number } | null = null

  for (const [, url = '', descriptor = '1x'] of srcset.matchAll(CANDIDATE)) {
    const weight = Number.parseFloat(descriptor) || 1
    if (!best || weight >= best.weight) best = { url, weight }
  }

  return best?.url ?? null
}

function followable(address: URL): boolean {
  return !runsCode(address) && address.protocol !== 'data:'
}

function undefer(root: ParentNode): void {
  for (const image of root.querySelectorAll('img')) {
    const found = bestSource(image)

    image.removeAttribute('srcset')
    image.removeAttribute('sizes')
    for (const name of LAZY) image.removeAttribute(name)

    if (found) image.setAttribute('src', found)
    else image.removeAttribute('src')

    const picture = image.parentElement
    if (picture?.tagName.toLowerCase() === 'picture') picture.replaceWith(image)
  }
}

export function absolutise(root: ParentNode, base: string): void {
  for (const link of root.querySelectorAll('a[href]')) {
    const target = absolute(link.getAttribute('href') ?? '', base)

    if (target && followable(target)) link.setAttribute('href', target.href)
    else link.removeAttribute('href')
  }

  undefer(root)

  for (const image of root.querySelectorAll('img')) {
    const src = image.getAttribute('src') ?? ''
    const target = src ? absolute(src, base) : null

    if (!target || runsCode(target)) {
      image.remove()
      continue
    }

    image.setAttribute('src', target.href)
  }
}

function bestSource(image: Element): string | null {
  const src = image.getAttribute('src') ?? ''
  if (!isPlaceholder(src)) return src

  for (const name of LAZY) {
    const deferred = image.getAttribute(name)
    if (deferred) return deferred
  }

  const own = image.getAttribute('srcset') ?? image.getAttribute('data-srcset')
  if (own) return widestOf(own)

  const picture = image.parentElement
  if (picture?.tagName.toLowerCase() === 'picture') {
    for (const source of picture.querySelectorAll('source[srcset]')) {
      const widest = widestOf(source.getAttribute('srcset') ?? '')
      if (widest) return widest
    }
  }

  return src || null
}

function unhide(element: Element): void {
  element.removeAttribute('hidden')
  element.removeAttribute('aria-hidden')

  const left = (element.getAttribute('style') ?? '')
    .replace(/(?:display|visibility)\s*:[^;]*;?/gi, '')
    .trim()

  if (left) element.setAttribute('style', left)
  else element.removeAttribute('style')
}

function keepMaths(root: ParentNode): void {
  for (const formula of root.querySelectorAll('math')) {
    let at: Element | null = formula

    while (at) {
      unhide(at)

      const above: Element | null = at.parentElement
      at = above?.children.length === 1 ? above : null
    }
  }
}

const NEVER_KEPT = /^(?:on|style$|srcdoc$|formaction$|xlink:href$)/i

export function clean(root: ParentNode): void {
  keepMaths(root)
  for (const form of root.querySelectorAll('form')) if (!formSays(form)) form.remove()
  for (const element of root.querySelectorAll(NOT_CONTENT)) element.remove()

  const all = root.querySelectorAll('*')
  for (const element of [...(root instanceof Element ? [root] : []), ...all]) {
    for (const name of element.getAttributeNames()) {
      if (NEVER_KEPT.test(name)) element.removeAttribute(name)
    }
  }
}

export function pageTags(document: Document): string[] {
  const written: string[] = []

  for (const meta of document.querySelectorAll('meta[name], meta[property]')) {
    const name = (meta.getAttribute('name') ?? meta.getAttribute('property') ?? '').toLowerCase()
    if (name !== 'keywords' && name !== 'news_keywords' && name !== 'article:tag') continue

    written.push(...(meta.getAttribute('content') ?? '').split(','))
  }

  const tags: string[] = []
  for (const one of written) {
    const tag = one.trim().replace(/\s+/g, ' ').slice(0, 32)
    if (tag && !tags.includes(tag)) tags.push(tag)
  }

  return tags.slice(0, 8)
}

function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const last = parsed.pathname.split('/').filter(Boolean).at(-1)
    return last ? decodeURIComponent(last.replace(/\.[a-z0-9]{1,5}$/i, '')) : parsed.hostname
  } catch {
    return url
  }
}

export function pageTitle(document: Document, url: string): string {
  const shared = document.querySelector('meta[property="og:title"]')?.getAttribute('content')

  const named = [shared ?? '', document.title].map((one) => one.trim()).find((one) => one !== '')
  return named ?? titleFromUrl(url)
}

export function linkTitle(document: Document, target: string): string {
  for (const anchor of document.querySelectorAll('a[href]')) {
    const href = (anchor as HTMLAnchorElement).href
    if (href !== target) continue

    const said = anchor.textContent.replace(/\s+/g, ' ').trim()
    if (said) return said.slice(0, 200)
  }

  return titleFromUrl(target)
}

function contentOf(node: ParentNode, base: string): string {
  clean(node)
  absolutise(node, base)

  const holder = node as { innerHTML?: string }
  return (holder.innerHTML ?? '').trim()
}

function baseOf(document: Document, url: string): string {
  return document.baseURI || url
}

function readable(
  document: Document,
  url: string,
  base: string,
): { title: string; html: string } | null {
  const clone = document.cloneNode(true) as Document

  absolutise(clone.body, base)

  keepMaths(clone.body)

  const article = new Readability(clone, { keepClasses: true }).parse()
  if (!article?.content) return null

  const parsed = document.implementation.createHTMLDocument('')
  parsed.body.innerHTML = article.content

  const html = contentOf(parsed.body, base)
  if (!parsed.body.textContent.trim() && !parsed.body.querySelector('img, picture')) return null

  const named = article.title?.trim() ?? ''
  return { title: named === '' ? pageTitle(document, url) : named, html }
}

function selected(document: Document, base: string): string {
  const selection = document.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return ''

  const holder = document.implementation.createHTMLDocument('')
  for (let index = 0; index < selection.rangeCount; index++) {
    holder.body.appendChild(selection.getRangeAt(index).cloneContents())
  }

  return contentOf(holder.body, base)
}

function whole(document: Document, base: string): string {
  const holder = document.implementation.createHTMLDocument('')
  holder.body.innerHTML = document.body.innerHTML

  return contentOf(holder.body, base)
}

export function extract(document: Document, kind: ClipKind, url: string, link?: string): Source {
  const tags = pageTags(document)

  if (kind === 'link') {
    const target = link ?? url
    const title = link ? linkTitle(document, link) : pageTitle(document, url)
    return { kind, url: target, title, html: '', tags }
  }

  const base = baseOf(document, url)

  if (kind === 'selection') {
    return { kind, url, title: pageTitle(document, url), html: selected(document, base), tags }
  }

  const article = readable(document, url, base)
  if (article) return { kind, url, title: article.title, html: article.html, tags }

  const fallback = selected(document, base) || whole(document, base)
  return { kind, url, title: pageTitle(document, url), html: fallback, tags }
}

export function readSnapshot(html: string, url: string): Source {
  const page = new DOMParser().parseFromString(html, 'text/html')

  if (!page.querySelector('base[href]')) {
    const base = page.createElement('base')
    base.setAttribute('href', url)
    page.head.prepend(base)
  }

  if (!page.documentElement.hasAttribute(SELECTED)) return extract(page, 'page', url)

  return {
    kind: 'selection',
    url,
    title: pageTitle(page, url),
    html: contentOf(page.body, baseOf(page, url)),
    tags: pageTags(page),
  }
}
