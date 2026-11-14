import { canWriteAt } from '../../../sharing/src/api'
import { samePath } from '../../../platform/src/api'
import { workspace } from '../../../workspace.svelte'
import { writeIfAbsent } from '../../../workspace/write-file'
import type { Thread } from '../../../ai-providers/src/api'
import { found, foundNamed, fromOthers, rootOfSpace } from './found'
import { type Host, sendHere } from './host'
import { type Held, setRemembers, STYLES } from './instructions'
import { commandName } from './notes'

const AGENTS = 'AGENTS.md'

function rootOf(thread: Thread | null): string | null {
  const space = thread ? workspace.spaces.find((one) => one.id === thread.space) : null
  return space?.root ?? workspace.activeSpace?.root ?? null
}

export async function memory(host: Host, thread: Thread | null, args: string): Promise<void> {
  const word = args.trim().toLowerCase()
  if (word === 'on' || word === 'off') {
    setRemembers(word === 'on')
    if (thread) host.line(thread, `Memory: ${word === 'on' ? '✓' : '✕'}`)
    return
  }
  const root = rootOf(thread)
  if (!root) return
  const path = `${root}/${AGENTS}`
  if (canWriteAt(path) && (await writeIfAbsent(path, '# AGENTS\n\n## Memory\n'))) {
    if (samePath(root, workspace.activeSpace?.root)) await workspace.loadTree()
    await workspace.fileCame(path, 'file')
    const { sync } = await import('../../../sync.svelte')
    sync.nudge()
  }
  await workspace.open(path)
}

const INIT = [
  'Write AGENTS.md at the root of this space: the instructions an assistant should follow here.',
  'First look around with your tools: the folders and what goes in each, the tags in use, the templates, how notes are named and linked, the languages they are written in, and the habits they show.',
  'Then write it as a short note in sections (Layout, Conventions, Memory, with an empty Memory section for later),',
  'with create_note, or with edit_note to improve the one that is there. Change no other note.',
].join(' ')

export function init(host: Host, thread: Thread | null): void {
  sendHere(host, thread, INIT, { mode: 'auto' })
}

export function mention(host: Host, thing: string): void {
  const { panel } = host
  if (panel.text !== undefined) panel.text = `@${thing.trim().replace(/^@/, '')}`
}

function listed(names: readonly string[], chosen?: string, prefix = ''): string {
  return names.map((name) => `${name === chosen ? '● ' : ''}${prefix}${name}`).join('  ') || '∅'
}

export async function skills(host: Host, thread: Thread | null, args: string): Promise<void> {
  const notes = (await found()).filter((one) => one.kind === 'command')
  const name = commandName(args)
  const one = name ? notes.find((note) => note.name === name) : null
  if (one) {
    await workspace.open(one.path)
    return
  }
  if (thread)
    host.line(
      thread,
      listed(
        notes.map((note) => note.name),
        undefined,
        '/',
      ),
    )
}

async function inThreadSpace(thread: Thread) {
  const root = rootOfSpace(thread.space)
  return root ? await found(root) : []
}

export async function agents(host: Host, thread: Thread | null, args: string): Promise<void> {
  const open = thread ?? host.panel.ensure?.() ?? null
  if (!open) return
  const held = open as Held
  const name = commandName(args)
  if (!name) {
    const profiles = (await inThreadSpace(open))
      .filter((one) => one.kind === 'agent')
      .map((one) => one.name)
    host.line(open, listed(profiles, held.agent))
    return
  }
  if (name === 'none' || name === 'default') {
    delete held.agent
    host.touched(open)
    return
  }
  const root = rootOfSpace(open.space)
  const profile = root ? await foundNamed('agent', name, root) : null
  if (!profile) {
    host.line(open, 'No such agent')
    return
  }
  held.agent = profile.name
  if (profile.model) host.panel.modelNamed(profile.model)
  if (profile.effort) host.panel.setEffort(profile.effort)
  if (profile.mode && !(await fromOthers(profile.path))) host.panel.setMode(profile.mode)
  host.touched(open)
}

export async function outputStyle(host: Host, thread: Thread | null, args: string): Promise<void> {
  const open = thread ?? host.panel.ensure?.() ?? null
  if (!open) return
  const held = open as Held
  const name = commandName(args)
  const notes = (await inThreadSpace(open))
    .filter((one) => one.kind === 'output-style')
    .map((one) => one.name)
  const all = [...Object.keys(STYLES), ...notes]
  if (!name) {
    host.line(open, listed(all, held.style ?? 'default'))
    return
  }
  if (!all.includes(name)) {
    host.line(open, 'No such style')
    return
  }
  if (name === 'default') delete held.style
  else held.style = name
  host.touched(open)
}
