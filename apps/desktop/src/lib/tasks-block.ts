import type { Answer, Row } from '@orden/bases'
import { escapeAll } from '@orden/markdown/html'
import { shownName } from './note-name'
import { trustsHtmlAt } from './sharing.svelte'
import { insideSpace } from './space-paths'

const MOST = 50

async function rowsOfSpace(
  root: string | null,
): Promise<{ rows: readonly Row[]; root: string } | null> {
  const [{ rows }, { workspace }] = await Promise.all([
    import('./rows/rows.svelte'),
    import('./workspace.svelte'),
  ])
  const space =
    root === null ? workspace.activeSpace : workspace.spaces.find((one) => one.root === root)
  if (!space) return null
  if (!rows.ready) {
    await new Promise<void>((resolve) => {
      const stop = rows.watch(() => {
        if (!rows.ready) return
        stop()
        resolve()
      })
      setTimeout(() => {
        stop()
        resolve()
      }, 1500)
    })
  }
  return { rows: rows.shown(space.name), root: space.root }
}

function row(task: Row, root: string): string {
  const fields = task.task
  if (!fields || !task.anchor) return ''
  const where = `data-path="${escapeAll(insideSpace(root, task.path))}" data-line="${task.anchor.line}" data-hash="${escapeAll(task.anchor.hash)}"`
  const box =
    `<input type="checkbox" class="nib-checkbox" data-task ${where}` +
    `${fields.done ? ' checked' : ''} aria-label="${escapeAll(fields.text)}">`
  const title = `title="${escapeAll(shownName(task.file.name))}"`
  return `<button type="button" class="nib-row is-short" ${where} ${title}>${box}${escapeAll(fields.text)}</button>`
}

function drawn(
  answer: Answer,
  root: string,
  unread: readonly string[],
  nothing: string,
  groupName: (key: Answer['groups'][number]['key']) => string,
): string {
  let left = MOST
  const groups = answer.groups
    .map((group) => {
      const rows = group.rows.slice(0, Math.max(left, 0))
      left -= rows.length
      if (!rows.length) return ''
      const name = groupName(group.key)
      const head = name
        ? `<p class="nib-section">${escapeAll(name)}<span>${group.rows.length}</span></p>`
        : ''
      return head + rows.map((one) => row(one, root)).join('')
    })
    .join('')
  const unreadLines = unread.length
    ? `<p class="nib-query-none">${unread.map((line) => escapeAll(line)).join('<br>')}</p>`
    : ''
  const body = groups || `<p class="nib-query-none">${escapeAll(nothing)}</p>`
  return `<div class="nib-query">${body}${unreadLines}</div>`
}

export async function tasksRowsHtml(
  code: string,
  nothing: string,
  root: string | null = null,
  stranger = false,
): Promise<string | null> {
  const [{ answer, groupName }, { readTasksQuery }, { refusedPattern, todayOf }, space] =
    await Promise.all([
      import('@orden/bases/answer'),
      import('@orden/bases/tasks-query'),
      import('@orden/bases'),
      rowsOfSpace(root),
    ])
  if (!space) return null
  const { base: read, unsupported } = readTasksQuery(code)
  const guarded = stranger || !trustsHtmlAt(root)
  const refused = guarded ? refusedPattern(read) : null
  if (refused !== null) return `<p class="nib-query-none">${escapeAll(refused)}</p>`
  const base = { ...read, guarded }
  const now = new Date()
  const stamp = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString()
  const result = answer(base, 0, space.rows, { today: todayOf(now), now: stamp.slice(0, 19) })
  return drawn(result, space.root, unsupported, nothing, groupName)
}
