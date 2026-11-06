import type { AgentAnswer } from '../../automation/caller'
import { readable as guarded } from './guarded'
import { type Canvas, merged, readCanvas as parse, stamped, writeCanvas } from '../../canvas/format'
import { canWriteAt } from '../../sharing.svelte'
import { invoke } from '../../tauri'
import { writeFile } from '../../workspace/write-file'
import { workspace } from '../../workspace.svelte'
import { isCanvasTarget, isPagesTarget } from '@orden/markdown/links'
import type { NoteDoc } from '../../workspace/documents.svelte'
import { asked } from './asks'
import { applied, readable } from './canvas-ops'
import { type Call, done, maybe, need } from './call'
import { readablePages } from './pages-ops'
import { Refused } from './problem'
import { namedTab, tabsOwnSpace } from './tab-target'
import { kindsWhere } from '../../workspace/tab-kinds'
import {
  docSource,
  judged,
  judgedForWriting,
  onDisk,
  type Place,
  placeOf,
  sharedSource,
} from './spaces'

interface Target {
  place: Place
  relative: string
  path: string | null
  draft: NoteDoc | null
}

function canvasOf(call: Call, writing: boolean): Target {
  if (maybe(call, 'tab') !== null) return canvasInTab(call, writing)

  const place = placeOf(call)
  const asked = need(call, 'path')
  const relative = writing ? judgedForWriting(asked) : judged(asked)
  if (!isCanvasTarget(relative) && !isPagesTarget(relative)) {
    throw new Refused('bad_arguments', `${relative} is not a canvas or a page note`)
  }

  const path = onDisk(place, relative)
  if (writing && !canWriteAt(path)) {
    throw new Refused('read_only', `${place.space.name} is shared with you to read`)
  }

  guarded(path, relative)
  return { place, relative, path, draft: null }
}

const PLANES = kindsWhere((one) => one.plane)

function canvasInTab(call: Call, writing: boolean): Target {
  const { tab, place, relative } = namedTab(call, PLANES, 'a canvas or page note')
  if (relative !== null) {
    const args = { ...call.args, tab: null, path: relative, space: place.space.id }
    return canvasOf({ ...call, args }, writing)
  }
  if (tab.path !== null) throw new Refused('by_hand', `tab ${tab.id} is outside every space`)
  if (tab.note.shared !== null) {
    throw new Refused('by_hand', `tab ${tab.id} is a canvas somebody shared, kept by its room`)
  }
  tabsOwnSpace(call, tab, place)

  return { place, relative: '', path: null, draft: tab.note }
}

function openAs(target: Target): NoteDoc | null {
  return target.draft ?? (target.path === null ? null : workspace.documentAt(target.path))
}

async function drawnAt(target: Target) {
  const open = openAs(target)
  if (!open) return null

  const { CanvasStore } = await import('../../canvas/store.svelte')
  return CanvasStore.drawing(open, workspace.tabs)
}

async function canvasAt(target: Target): Promise<Canvas> {
  const drawn = await drawnAt(target)
  if (drawn) return drawn.canvas

  const open = openAs(target)
  if (open) {
    open.flush()
    return parse(open.text)
  }

  const words =
    target.path === null
      ? null
      : await invoke<string>('read_note', { path: target.path }).catch(() => null)
  if (words === null) throw new Refused('no_such_file', 'there is no canvas there')

  return parse(words)
}

function isPages(target: Target): boolean {
  return target.draft ? target.draft.kind === 'pages' : isPagesTarget(target.relative)
}

function nameOf(target: Target, call: Call): string {
  return target.relative || `tab ${maybe(call, 'tab') ?? ''}`
}

export async function readCanvas(call: Call): Promise<AgentAnswer> {
  const target = canvasOf(call, false)
  const canvas = await canvasAt(target)
  const read = isPages(target) ? readablePages(canvas) : readable(canvas)
  return done(
    { path: target.relative, ...read },
    target.draft ? docSource(target.draft) : sharedSource(target.place, target.relative),
  )
}

export async function editCanvas(call: Call): Promise<AgentAnswer> {
  const target = canvasOf(call, true)
  applied(await canvasAt(target), call.args.ops)

  const named = nameOf(target, call)
  const question = await asked(call, null, `Edit the canvas ${named} in ${target.place.space.name}`)
  if (question) return question

  const made = await edited(target, call.args.ops, call.caller.agent?.name)
  return done({ path: target.relative, made })
}

async function edited(target: Target, ops: unknown, source: string | undefined): Promise<string[]> {
  const drawn = await drawnAt(target)
  if (drawn) {
    const done = applied(drawn.canvas, ops)
    drawn.edit(done.canvas)
    return done.made
  }

  const open = openAs(target)
  if (open) {
    open.flush()
    const before = parse(open.text)
    const done = applied(before, ops)
    open.replace(writeCanvas(stamped(before, done.canvas, Date.now())))
    return done.made
  }

  const path = target.path
  if (path === null) throw new Refused('no_such_file', 'there is no canvas there')
  const was = await invoke<string>('read_note', { path })
  const before = parse(was)
  const done = applied(before, ops)
  const mine = stamped(before, done.canvas, Date.now())

  const now = await invoke<string>('read_note', { path }).catch(() => was)
  const kept = now === was ? mine : merged(mine, parse(now))

  await invoke('snapshot_note', { path, content: now, source }).catch(() => undefined)
  await writeFile(path, writeCanvas(kept))
  return done.made
}
