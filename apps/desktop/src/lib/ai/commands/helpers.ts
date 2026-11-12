import { TAG_NAME } from '@orden/markdown/tags'
import type { Query } from '@orden/scan/search/query'
import { within } from '../../space-paths'
import { workspace } from '../../workspace.svelte'
import { branchThread, newThread } from '../chat/threads'
import { helpers } from '../helpers/helpers.svelte'
import type { Mode, Thread } from '../chat/types'
import type { Host } from './host'
import { answerOf } from './loop'
import { tasks, type TaskKind } from './tasks.svelte'
import type { Ended } from './types'

const AT_ONCE = 3

function helperOf(parent: Thread, title: string, copy: boolean, mode?: Mode, own = false): Thread {
  const last = parent.turns.at(-1)
  const made =
    copy && last
      ? branchThread(parent, last.id, title)
      : {
          ...newThread(
            parent.space,
            parent.provider,
            parent.model,
            parent.effort,
            mode ?? parent.mode,
          ),
          title,
        }
  if (mode) made.mode = mode
  if (own) delete made.parent
  else made.parent = parent.id
  return made
}

async function run(
  host: Host,
  parent: Thread,
  helper: Thread,
  kind: TaskKind,
  text: string,
  label = text,
): Promise<Ended | null> {
  const stopper = new AbortController()
  const task = tasks.add({
    thread: parent.id,
    kind,
    label,
    helper: helper.id,
    stop: () => stopper.abort(),
  })
  helpers.startedUnder(parent, helper)
  host.adopt(helper)
  try {
    return await host.turn(helper, text, { signal: stopper.signal })
  } catch {
    return null
  } finally {
    tasks.done(task.id)
    helpers.endedUnder(helper.id)
  }
}

function answered(task: string, ended: Ended | null): string {
  const words = ended ? answerOf(ended).trim() : ''
  const failed = !ended || ended.stop === 'error'
  return `↳ ${task}\n\n${failed ? (ended?.error ?? 'The model did not answer.') : words}`
}

export function fork(host: Host, parent: Thread, prompt: string): void {
  const copy = helperOf(parent, parent.title, true, undefined, true)
  host.touched(parent)
  if (prompt) void run(host, parent, copy, 'fork', prompt)
  else host.adopt(copy)
}

export async function subtask(host: Host, parent: Thread, task: string): Promise<void> {
  const copy = helperOf(parent, task.slice(0, 80), true)
  host.touched(parent)
  const ended = await run(host, parent, copy, 'subtask', task)
  if (ended?.stop === 'stopped') return
  host.line(parent, answered(task, ended), undefined, [copy.id])
}

const TAG_WORD = new RegExp(String.raw`^#${TAG_NAME}$`, 'u')

export function batchTargets(instruction: string): { folders: string[]; tags: string[] } {
  const words = instruction.split(/\s+/).map((one) => one.replace(/^@/, '').replace(/[.,;:]+$/, ''))
  return {
    folders: words.filter((one) => one.length > 1 && one.endsWith('/')),
    tags: words.filter((one) => TAG_WORD.test(one)).map((one) => one.slice(1)),
  }
}

const MOST_NOTES = 1_000

const EVERY_PATH = 1_000_000

function inFolder(relative: string, folder: string): boolean {
  const wanted = folder
    .replace(/\\/g, '/')
    .replace(/^(\.?\/)+/, '')
    .toLowerCase()
  return relative.replace(/\\/g, '/').toLowerCase().startsWith(wanted)
}

async function batchNotes(
  root: string,
  targets: { folders: string[]; tags: string[] },
): Promise<string[]> {
  const { searchSpace } = await import('../../search/space')
  const paths = new Set<string>()
  const ask = async (of: Query[], most: number, keep: (path: string) => boolean): Promise<void> => {
    if (!of.length) return
    await searchSpace(
      root,
      { kind: 'any', of },
      [],
      most,
      (batch) => {
        for (const hit of batch.hits)
          if (hit.page === undefined && !hit.tab && keep(hit.path) && paths.size < MOST_NOTES)
            paths.add(hit.path)
      },
      workspace.leftOutOf(root),
    )
  }
  const inOne = (path: string) => {
    const relative = within(root, path)
    return relative !== null && targets.folders.some((folder) => inFolder(relative, folder))
  }
  await ask(
    targets.folders.map((text): Query => ({ kind: 'path', text, fold: true })),
    EVERY_PATH,
    inOne,
  )
  await ask(
    targets.tags.map((tag): Query => ({ kind: 'tag', tag })),
    MOST_NOTES,
    () => true,
  )
  return [...paths].sort()
}

function linkOf(path: string, root: string): string {
  const relative = path.startsWith(root) ? path.slice(root.length).replace(/^[\\/]+/, '') : path
  return relative.replace(/\\/g, '/').replace(/\.md$/i, '')
}

export async function batch(host: Host, parent: Thread, instruction: string): Promise<void> {
  const root =
    workspace.spaces.find((one) => one.id === parent.space)?.root ?? workspace.activeSpace?.root
  const targets = batchTargets(instruction)
  if (!root || (!targets.folders.length && !targets.tags.length)) {
    host.line(parent, 'Name a folder or a tag')
    return
  }
  const notes = await batchNotes(root, targets)
  const stopper = new AbortController()
  const task = tasks.add({
    thread: parent.id,
    kind: 'batch',
    label: instruction,
    stop: () => stopper.abort(),
  })
  let done = 0
  let next = 0
  const started: string[] = []
  const one = async (): Promise<void> => {
    while (next < notes.length && !stopper.signal.aborted) {
      const path = notes[next++] ?? ''
      const helper = helperOf(
        parent,
        `${instruction.slice(0, 60)}, ${linkOf(path, root)}`,
        false,
        parent.mode,
      )
      started.push(helper.id)
      helpers.startedUnder(parent, helper)
      host.adopt(helper)
      const ended = await host
        .turn(helper, `${instruction}\n\nWork on this one note only: [[${linkOf(path, root)}]]`, {
          signal: stopper.signal,
        })
        .catch(() => null)
      helpers.endedUnder(helper.id)
      if (ended && ended.stop !== 'error' && ended.stop !== 'stopped') done++
    }
  }
  host.touched(parent)
  try {
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, notes.length) }, one))
  } finally {
    tasks.done(task.id)
  }
  host.line(parent, `↳ ${instruction}\n\n✓ ${done}/${notes.length}`, undefined, started)
}

export function researchPrompt(question: string): string {
  return [
    `Research this question: ${question}`,
    'Search the web and read the pages with your browser tools, in tabs of your own; follow the best sources and cross-check what they say.',
    'Then write a report as one new note under Research/ with create_note, named after the question:',
    'a short answer first, then the findings, each claim with a numbered citation, and the sources as a numbered list of links at the end.',
    'Answer here with the note’s name and the short answer.',
  ].join(' ')
}

export async function research(host: Host, parent: Thread, question: string): Promise<void> {
  const helper = helperOf(parent, question.slice(0, 80), false, parent.mode)
  host.touched(parent)
  const ended = await run(host, parent, helper, 'research', researchPrompt(question), question)
  if (ended?.stop === 'stopped') return
  host.line(parent, answered(question, ended), undefined, [helper.id])
}
