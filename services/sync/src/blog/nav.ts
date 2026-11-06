import { escape } from './head'
import type { NoteFront } from './front'

export interface Listed {
  slug: string
  title: string
  path: string
  front: NoteFront
}

interface Branch {
  name: string
  folders: Map<string, Branch>
  pages: Listed[]
}

function branch(name: string): Branch {
  return { name, folders: new Map(), pages: [] }
}

function ordered(pages: readonly Listed[]): Listed[] {
  return [...pages].sort((one, other) => {
    const said = one.front.order
    const theirs = other.front.order

    if (said !== undefined && theirs !== undefined && said !== theirs) return said - theirs
    if (said !== undefined && theirs === undefined) return -1
    if (said === undefined && theirs !== undefined) return 1

    return one.title.localeCompare(other.title)
  })
}

function tree(pages: readonly Listed[]): Branch {
  const root = branch('')

  for (const page of pages) {
    const parts = page.path.split('/')
    const file = parts.pop()
    if (!file) continue

    let held = root
    for (const part of parts) {
      const next = held.folders.get(part) ?? branch(part)
      held.folders.set(part, next)
      held = next
    }

    held.pages.push(page)
  }

  return root
}

function folderOrder(held: Branch): number | undefined {
  const said = [
    ...held.pages.map((one) => one.front.order),
    ...[...held.folders.values()].map((one) => folderOrder(one)),
  ].filter((one): one is number => one !== undefined)

  return said.length ? Math.min(...said) : undefined
}

function branches(held: Branch): Branch[] {
  return [...held.folders.values()].sort((one, other) => {
    const said = folderOrder(one)
    const theirs = folderOrder(other)

    if (said !== undefined && theirs !== undefined && said !== theirs) return said - theirs
    if (said !== undefined && theirs === undefined) return -1
    if (said === undefined && theirs !== undefined) return 1

    return one.name.localeCompare(other.name)
  })
}

export function inOrder(pages: readonly Listed[]): Listed[] {
  const out: Listed[] = []

  const walk = (held: Branch) => {
    for (const page of ordered(held.pages)) out.push(page)
    for (const under of branches(held)) walk(under)
  }

  walk(tree(pages))
  return out
}

export function navigation(pages: readonly Listed[], current: string): string {
  const rows = (held: Branch, depth: number): string => {
    const out: string[] = []

    for (const page of ordered(held.pages)) {
      const here = page.slug === current
      out.push(
        `<li><a href="/${escape(page.slug)}"${here ? ' aria-current="page"' : ''}>${escape(
          page.title,
        )}</a></li>`,
      )
    }

    for (const under of branches(held)) {
      const inside = holds(under, current)
      out.push(
        `<li><details${inside ? ' open' : ''}><summary>${escape(under.name)}</summary>` +
          `<ul>${rows(under, depth + 1)}</ul></details></li>`,
      )
    }

    return out.join('')
  }

  const root = tree(pages)
  const body = rows(root, 0)
  if (!body) return ''

  return `<nav class="pages"><details class="all"><summary>Pages</summary><ul>${body}</ul></details></nav>`
}

function holds(held: Branch, current: string): boolean {
  return (
    held.pages.some((one) => one.slug === current) ||
    [...held.folders.values()].some((one) => holds(one, current))
  )
}

export function around(
  pages: readonly Listed[],
  current: string,
): { before: Listed | null; after: Listed | null } {
  const flat = inOrder(pages)
  const at = flat.findIndex((one) => one.slug === current)
  if (at < 0) return { before: null, after: null }

  return { before: flat[at - 1] ?? null, after: flat[at + 1] ?? null }
}

export function beforeAndAfter(pages: readonly Listed[], current: string): string {
  const { before, after } = around(pages, current)
  if (!before && !after) return ''

  const one = (page: Listed | null, which: 'before' | 'after') =>
    page
      ? `<a class="${which}" href="/${escape(page.slug)}" rel="${which === 'before' ? 'prev' : 'next'}">${escape(page.title)}</a>`
      : '<span></span>'

  return `<nav class="around">${one(before, 'before')}${one(after, 'after')}</nav>`
}

function namesOf(page: Listed): string[] {
  const whole = page.path
    .replace(/\.(md|markdown|mdown|mkd)$/i, '')
    .replace(/\\/g, '/')
    .toLowerCase()
  const parts = whole.split('/')
  const names = parts.map((_part, at) => parts.slice(at).join('/'))

  return [...names, ...(page.front.aliases ?? [])]
}

export function linkedFrom(pages: readonly Listed[], page: Listed): Listed[] {
  const names = namesOf(page)
  const known = new Set(names)
  const reaches = (link: string) =>
    link.startsWith('/') ? link.slice(1) === names[0] : known.has(link)

  return ordered(
    pages.filter((one) => one.slug !== page.slug && (one.front.links ?? []).some(reaches)),
  )
}

export function backlinks(pages: readonly Listed[], page: Listed): string {
  const found = linkedFrom(pages, page)
  if (!found.length) return ''

  const rows = found
    .map((one) => `<li><a href="/${escape(one.slug)}">${escape(one.title)}</a></li>`)
    .join('')

  return `<nav class="linked"><h2>Linked from</h2><ul>${rows}</ul></nav>`
}
