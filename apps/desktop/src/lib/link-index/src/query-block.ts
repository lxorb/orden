import { workspaceNotes } from '@orden/contracts'
import { escapeAll } from '@orden/markdown/html'
import { shownName } from '../../platform/src/api'
import type { Hit } from '@orden/scan/search/match'
import { taskOf, taskWordsOf } from '@orden/scan/search/task'
import { parseQuery } from '@orden/scan/search/query'
import { services } from './services'

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
function row(hit: Hit, hashOf: (words: string) => string): string {
  const where = `data-path="${escapeAll(hit.path)}" data-line="${hit.line}"`
  const task = taskOf(hit)
  if (!task) {
    return `<button type="button" class="orden-row is-short" ${where}>${marked(hit.text, hit.ranges)}</button>`
  }
  const words = taskWordsOf(hit)
  const hash = words === null ? '' : ` data-hash="${escapeAll(hashOf(words))}"`
  const box =
    `<input type="checkbox" class="orden-checkbox" data-task ${where}${hash}` +
    `${task.done ? ' checked' : ''} aria-label="${escapeAll(task.text)}">`
  return `<button type="button" class="orden-row is-short" ${where}>${box}${marked(task.text, task.ranges)}</button>`
}
export async function queryRowsHtml(code: string, nothing: string, root: string | null = null): Promise<string | null> {
  const said = queryIn(code)
  if (!said) return null
  root ??= workspaceNotes().activeRoot
  if (!root) return null
  const query = parseQuery(said)
  const hits: Hit[] = []
  await services()
    .search(root, query, [], MOST, (batch) => hits.push(...batch.hits), workspaceNotes().leftOut(root))
    .catch(() => undefined)
  if (!hits.length) return `<div class="orden-query"><p class="orden-query-none">${escapeAll(nothing)}</p></div>`
  const { taskHash } = await import('@orden/bases')
  const groups = grouped(hits)
    .map((group) => {
      const rows = group.hits.map((one) => row(one, taskHash)).join('')
      return `<p class="orden-section">${escapeAll(shownName(group.name))}<span>${group.hits.length}</span></p>${rows}`
    })
    .join('')
  return `<div class="orden-query">${groups}</div>`
}
export function pressRow(target: EventTarget | null): boolean {
  const found = target instanceof Element ? target.closest('[data-path]') : null
  if (!(found instanceof HTMLElement)) return false
  const path = found.dataset.path
  if (path === undefined) return false
  const line = Number(found.dataset.line ?? 0)
  if (found.dataset.task === undefined) void workspaceNotes().openAt(path, line)
  else void workspaceNotes().toggleTaskAt(path, line, found.dataset.hash)
  return true
}
