import { attachmentFolder } from '../attachments'
import { busy, prompt } from '../ui-kit/src/api'
import {
  fromBase64,
  log,
  insideAnyOf,
  joinPath,
  waited,
  answer,
  frameWord,
  method,
  onTheActivity,
  wordSaid,
} from '../platform/src/api'
import { appCommands } from '../commands'
import { applyImport } from '../import/src/api'
import { putPicture, writeAtCaret } from '../insert-picture'
import { modes } from '../modes.svelte'
import { views } from '../views.svelte'
import { workspace } from '../workspace.svelte'
import {
  type Arrived,
  arrivedFrom,
  isPicture,
  sharedPlan,
  sharedTask,
  sharedTitle,
  sharedMarkdown,
  sharedWords,
  type SharedItem,
} from './shared'
import { watchWidgets } from './widgets.svelte'

const SLICE = 256 * 1024

const SHOWN = 160

interface Asked {
  command: string
  open: string
  tick: string
  tickSpace: string
}

export const HANDED: ReadonlySet<string> = new Set(['new', 'search-space', 'record', 'quick-add'])

export function askedFrom(json: string): Asked {
  const nothing: Asked = { command: '', open: '', tick: '', tickSpace: '' }
  if (!json) return nothing

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return nothing
  }

  if (typeof parsed !== 'object' || parsed === null) return nothing
  const held = parsed as Record<string, unknown>

  const words = (value: unknown) => (typeof value === 'string' ? value : '')
  return {
    command: HANDED.has(words(held.command)) ? words(held.command) : '',
    open: words(held.open),
    tick: words(held.tick),
    tickSpace: words(held.tickSpace),
  }
}

function run(id: string): boolean {
  if (!id) return false

  const view = views.of(workspace.panes.focusedId)
  const found = appCommands(view).find((one) => one.id === id)
  if (!found || found.disabled) return false

  found.run()
  return true
}

export function openable(said: string): string | null {
  const found = insideAnyOf(
    workspace.spaces.map((one) => one.root),
    said,
  )
  if (!found) log('error', `handed: ${said} is not a note in any space`)

  return found
}

let retaking = false
let taking: Promise<void> | null = null
let again = false

function takeOnce(): void {
  if (taking) {
    again = true
    return
  }
  taking = take().finally(() => {
    taking = null
    if (!again) return
    again = false
    takeOnce()
  })
}

async function take(): Promise<void> {
  const word = await frameWord()
  if (!word) {
    if (!retaking) {
      retaking = true
      void wordSaid().then(takeOnce)
    }
    return
  }
  const asked = askedFrom(method('handed')?.(word) ?? '')

  const open = asked.open ? openable(asked.open) : null
  if (open) await workspace.open(open).catch(() => undefined)
  if (asked.command) run(asked.command)
  if (asked.tick) await ticked(asked.tick)

  await taken(word)
}

async function ticked(at: string): Promise<void> {
  const { tickTask } = await import('../task-actions')
  await tickTask(at, true).catch((error: unknown) => {
    log('error', `handed: a task could not be ticked: ${String(error)}`)
  })
}

async function taken(word: string): Promise<void> {
  const arrived = arrivedFrom(method('shared')?.(word) ?? '')
  if (!arrived) return

  let answered = true
  try {
    const bytes = await carried(arrived, word)
    const root = await landing()
    const where = await ask(arrived, root)

    if (where === 'kept') {
      answered = false
      log('error', 'shared: no space may be written in, so the share is kept')
    } else if (where === 'here') await intoTheOpenNote(arrived, bytes)
    else if (where === 'new' && root !== null) await intoANewNote(arrived, bytes, root)
    else if (where === 'task' && root !== null) await asATask(arrived)
  } catch (error) {
    log('error', `shared: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    if (answered) method('sharedDone')?.(word)
  }
}

async function carried(arrived: Arrived, word: string): Promise<Map<number, Uint8Array>> {
  const read = method('sharedBytes')
  const held = new Map<number, Uint8Array>()
  if (!read) return held

  for (const [at, item] of arrived.items.entries()) {
    if (item.text !== null || item.size <= 0) continue

    const parts: Uint8Array[] = []
    let got = 0

    while (got < item.size) {
      const text = read(word, at, got, SLICE)
      if (!text) break

      const bytes = fromBase64(text)
      if (!bytes.length) break

      parts.push(bytes)
      got += bytes.length
      await waited()
    }

    if (!got) continue

    const whole = new Uint8Array(got)
    let put = 0
    for (const part of parts) {
      whole.set(part, put)
      put += part.length
    }

    held.set(at, whole)
  }

  return held
}

async function landing(): Promise<string | null> {
  const { canWriteAt } = await import('../sharing/src/api')
  const open = workspace.activeSpace?.root
  if (open !== undefined && canWriteAt(open)) return open
  return workspace.spaces.find((one) => canWriteAt(one.root))?.root ?? null
}

async function ask(
  arrived: Arrived,
  root: string | null,
): Promise<'new' | 'here' | 'task' | 'kept' | null> {
  const tab = workspace.active
  const view = views.of(workspace.panes.focusedId)
  const fits = arrived.items.every((one) => one.text !== null || isPicture(one))
  const into = tab?.kind === 'note' && !!view && !view.state.readOnly && fits ? tab : null
  const words = arrived.items.every((one) => one.text !== null)
  if (root === null && !into) return 'kept'
  if (root !== null && !into && !words) return 'new'

  const chosen = await prompt.choose({
    title: 'Shared',
    detail: summary(arrived),
    options: [
      ...(root !== null ? [{ id: 'new', label: 'New note', primary: true }] : []),
      ...(into ? [{ id: 'here', label: `Add to ${into.shown}` }] : []),
      ...(root !== null && words ? [{ id: 'task', label: 'As a task' }] : []),
    ],
  })

  if (chosen === 'new' || chosen === 'here' || chosen === 'task') return chosen
  return null
}

async function asATask(arrived: Arrived) {
  const { addTask } = await import('../task-actions')
  await addTask(sharedTask(arrived), { typed: false })
}

function summary(arrived: Arrived): string {
  const words = sharedWords(arrived).replace(/\s+/g, ' ').trim()
  if (words) return words.length > SHOWN ? `${words.slice(0, SHOWN)}…` : words

  return arrived.items
    .map((one: SharedItem) => one.name)
    .filter(Boolean)
    .join(', ')
}

async function intoANewNote(
  arrived: Arrived,
  bytes: ReadonlyMap<number, Uint8Array>,
  root: string,
) {
  const folder = attachmentFolder(
    modes.attachments,
    joinPath(root, `${sharedTitle(arrived)}.md`),
    root,
  )

  const plan = sharedPlan(arrived, bytes, new Date(), folder)
  if (!plan.files.length) return

  const landed = await busy.run('Importing', () => applyImport(plan, { root, folder: '' }))

  const first = landed.paths[0]
  if (first) await workspace.openEntry(first)
}

async function intoTheOpenNote(arrived: Arrived, bytes: ReadonlyMap<number, Uint8Array>) {
  const view = views.of(workspace.panes.focusedId)
  if (!view) return

  const words = sharedMarkdown(arrived)
  if (words) writeAtCaret(view, words)

  for (const [at, item] of arrived.items.entries()) {
    const held = bytes.get(at)
    if (item.text !== null || !held?.length) continue

    const file = new File([new Uint8Array(held)], item.name || 'shared', { type: item.mime })
    await putPicture(view, file)
  }
}

export function startHanded(): () => void {
  if (!onTheActivity()) return () => undefined

  const stopWidgets = watchWidgets()

  answer('__ordenHanded', takeOnce)
  takeOnce()

  return () => {
    answer('__ordenHanded', undefined)
    stopWidgets()
  }
}
