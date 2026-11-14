import { escapeAll } from '@orden/markdown/html'
import { shownName } from './platform/src/api'
import type { Hit } from '@orden/scan/search/match'
import { taskOf } from '@orden/scan/search/task'
import { parseQuery } from '@orden/scan/search/query'
import { searchSpace } from './search/src/api'

const MOST = 40

const PER_NOTE = 5

function queryIn(code: string): string {
  return code.trim().replace(/\s*\n\s*/g, ' ')
}

function grouped(hits: readonly Hit[]): { name: string; hits: Hit[] }[] {
  const out: { name: string; hits: Hit[] }[] = []

  for (const hit of hits) {
    const last = out.at(-1)
    if (last && last.hits[0]?.path === hit.path) {
      if (last.hits.length < PER_NOTE) last.hits.push(hit)
    } else out.push({ name: hit.name, hits: [hit] })
  }

  return out
}

function marked(text: string, ranges: readonly { from: number; to: number }[]): string {
  let out = ''
  let at = 0

  for (const range of ranges) {
    if (range.from > at) out += escapeAll(text.slice(at, range.from))
    out += `<mark>${escapeAll(text.slice(range.from, range.to))}</mark>`
    at = range.to
  }

  return out + escapeAll(text.slice(at))
}

function row(hit: Hit): string {
  const where = `data-path="${escapeAll(hit.path)}" data-line="${hit.line}"`
  const task = taskOf(hit)

  if (!task) {
    return `<button type="button" class="orden-row is-short" ${where}>${marked(hit.text, hit.ranges)}</button>`
  }

  const box =
    `<input type="checkbox" class="orden-checkbox" data-task ${where}` +
    `${task.done ? ' checked' : ''} aria-label="${escapeAll(task.text)}">`

  return `<button type="button" class="orden-row is-short" ${where}>${box}${marked(task.text, task.ranges)}</button>`
}

export async function queryRowsHtml(
  code: string,
  nothing: string,
  root: string | null = null,
): Promise<string | null> {
  const said = queryIn(code)
  if (!said) return null

  const { workspace } = await import('./workspace.svelte')
  root ??= workspace.activeSpace?.root ?? null
  if (!root) return null

  const query = parseQuery(said)
  const hits: Hit[] = []
  await searchSpace(root, query, [], MOST, (batch) => hits.push(...batch.hits), [
    ...workspace.leftOutOf(root),
    workspace.instructionsName(root),
  ]).catch(() => undefined)

  if (!hits.length)
    return `<div class="orden-query"><p class="orden-query-none">${escapeAll(nothing)}</p></div>`

  const groups = grouped(hits)
    .map((group) => {
      const rows = group.hits.map(row).join('')

      return `<p class="orden-section">${escapeAll(shownName(group.name))}<span>${group.hits.length}</span></p>${rows}`
    })
    .join('')

  return `<div class="orden-query">${groups}</div>`
}

async function openQueryRow(path: string, line: number): Promise<void> {
  const { workspace } = await import('./workspace.svelte')
  await workspace.open(path)
  workspace.goto = { path, line }
}

async function tickQueryRow(path: string, line: number, hash?: string): Promise<void> {
  const { workspace } = await import('./workspace.svelte')
  await workspace.toggleTaskAt(path, line, hash)
}

export function pressRow(target: EventTarget | null): boolean {
  const found = target instanceof Element ? target.closest('[data-path]') : null
  if (!(found instanceof HTMLElement)) return false

  const path = found.dataset.path
  if (path === undefined) return false

  const line = Number(found.dataset.line ?? 0)
  if (found.dataset.task === undefined) void openQueryRow(path, line)
  else void tickQueryRow(path, line, found.dataset.hash)

  return true
}
