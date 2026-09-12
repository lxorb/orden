/** Getting around a site: the tree down the left, what links to a page, and the
 *  page before and after it.
 *
 *  All three come from one list - the pages the site publishes - so none of them
 *  can mention a page the site does not have. That is the whole reason they live
 *  together: a navigation built from the file tree and backlinks built from the
 *  link index would be two places where a private note could leak its name.
 *
 *  No script. The folders are `<details>`, which every browser opens and closes
 *  on its own, and the current page is marked by the server that knows which
 *  page it is serving. */

import { escape } from './head'
import type { NoteFront } from './front'

/** One page of the site, as everything here reads it: where it lives, what it is
 *  called, and what it says about itself. */
export interface Listed {
  slug: string
  title: string
  /** Its path in the space, which is what the tree is built from. */
  path: string
  front: NoteFront
}

/** A folder of the tree, or a page in it. */
interface Branch {
  name: string
  /** The folders under it, by name. */
  folders: Map<string, Branch>
  pages: Listed[]
}

function branch(name: string): Branch {
  return { name, folders: new Map(), pages: [] }
}

/** `order:` first and in order, then everything else by name. A page that says
 *  where it goes goes there; a page that says nothing is in the order a file list
 *  would show it, which is the order the author already sees in the app. */
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

/** The published pages as the tree they sit in. */
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

/** A folder's own place in the order: the earliest `order:` any page under it
 *  claims, so a folder of numbered pages sits where its pages do. */
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

/** Every page in the order the navigation shows them, flattened. What previous
 *  and next read, so the two cannot disagree with the list on the left. */
export function inOrder(pages: readonly Listed[]): Listed[] {
  const out: Listed[] = []

  const walk = (held: Branch) => {
    for (const page of ordered(held.pages)) out.push(page)
    for (const under of branches(held)) walk(under)
  }

  walk(tree(pages))
  return out
}

/** The tree, as the column down the left of every page.
 *
 *  A folder is a `<details>` and is open when the page being read is inside it,
 *  which is the one piece of state a navigation needs and the one a server can
 *  answer. Nothing is remembered between pages: a reader who closes a folder and
 *  follows a link into it wants to see where they are.
 *
 *  A hidden page - one the site does not publish - is not here. It is still
 *  reachable by its own address, which is what `publish: false` means: not
 *  listed, not private. */
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
  return body ? `<nav class="pages"><ul>${body}</ul></nav>` : ''
}

/** Whether the page being read is anywhere under this folder. */
function holds(held: Branch, current: string): boolean {
  return (
    held.pages.some((one) => one.slug === current) ||
    [...held.folders.values()].some((one) => holds(one, current))
  )
}

/** The page before and after this one, in the order the navigation shows.
 *
 *  Across folders rather than within one: a reader at the end of a folder wants
 *  the next thing to read, and the next thing to read is what comes next. */
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

/** Which of a note's names a link could have used for it: the path without its
 *  extension, every tail of that, and its aliases. The same reading the page's
 *  own link resolution does; see blog.ts. */
function namesOf(page: Listed): string[] {
  const whole = page.path
    .replace(/\.(md|markdown|mdown|mkd)$/i, '')
    .replace(/\\/g, '/')
    .toLowerCase()
  const parts = whole.split('/')
  const names = parts.map((_part, at) => parts.slice(at).join('/'))

  return [...names, ...(page.front.aliases ?? [])]
}

/** The pages that link to this one.
 *
 *  Read off what each page said about itself when it was saved rather than by
 *  fetching every note: the links out of a note are on its row. Published pages
 *  only, so a private note that links here is not named - which is the whole
 *  point of doing this from the site's own list. */
export function linkedFrom(pages: readonly Listed[], page: Listed): Listed[] {
  const names = new Set(namesOf(page))

  return ordered(
    pages.filter(
      (one) => one.slug !== page.slug && (one.front.links ?? []).some((link) => names.has(link)),
    ),
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
