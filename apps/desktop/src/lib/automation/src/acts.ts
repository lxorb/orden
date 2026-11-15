import { protection } from '../../protect/src/api'
import type { TextEdit } from '@orden/markdown/edits'
import { frontMatterBlock } from '@orden/markdown/front-matter'
import { typedItem, writeList, writeProperty } from '@orden/markdown/property-edits'
import { isQuoted, unquoted, writtenFlowItems } from '@orden/markdown/yaml'
import { LONGEST_META_VALUE } from '@orden/sync-core'
import { commandRowsLoaded } from '@orden/contracts'
import { appCommands } from '../../commands/src/api'
import { links } from '../../link-index/src/api'
import { writeIfAbsent } from '../../file-writes/src/api'
import {
  extensionOf,
  folderOf,
  insideSpace,
  isMarkdownPath,
  nameOf,
  nameToWrite,
  relativeTo,
  waited,
} from '../../platform/src/api'
import { search } from '../../search.svelte'
import { OWN_KEYS } from '../../own-keys'
import { views } from '../../views.svelte'
import { workspace } from '../../workspace/src/api'
import { type Road, said, type Said, words, yes } from './args'
import { publishStatus } from './answers'
import { keptFromAgents } from './front'
import { movedIn, movedPath, withExtension } from './moving'
import { insidePath, noteFor, openToAgents, relativeIn, spaceFor, spaceToWrite } from './space'

const SEARCH_PATIENCE = 8000

const LOOKING_AGAIN = 50

export async function openNote(args: Said): Promise<unknown> {
  const space = await spaceFor(args)
  const asked = said(args, 'path')
  if (!asked) throw new Error('say which path')

  const relative = insidePath((await named(asked)) ?? asked)
  const path = insideSpace(space.root, relative)

  const heading = said(args, 'heading')
  const block = said(args, 'block')

  if (block) await workspace.openAtBlock(`${relative}#^${block}`)
  else if (heading) await workspace.openAtHeading(relative, heading)
  else await workspace.openEntry(path)

  if (!workspace.tabs.some((tab) => tab.path === path)) {
    throw new Error(`there is no note at ${relative}`)
  }

  return { path: relative, heading: heading ?? null, block: block ?? null }
}

async function named(asked: string): Promise<string | null> {
  if (asked.includes('/') || asked.includes('\\')) return null

  await links.scanned()
  return links.targetOf(null, { kind: 'wikilink', target: asked })
}

export async function newNote(args: Said): Promise<unknown> {
  const space = await spaceToWrite(args)
  const content = words(args, 'content') ?? ''
  const silent = yes(args, 'silent')
  const append = yes(args, 'append')
  const prepend = yes(args, 'prepend')

  const relative = wanted(args)
  const path = insideSpace(space.root, relative)
  openToAgents(path, relative)
  const before = await workspace.noteText(path)

  if (before !== null) {
    if (!append && !prepend) {
      throw new Error(`${relative} is already there: say append or prepend to add to it`)
    }

    const after = append ? joined(before, content) : prepended(before, content)
    wroteTo(
      relative,
      await workspace.replaceInNotes([
        {
          path,
          before,
          after,
          edits: [{ from: 0, to: before.length, insert: after }],
          back: [{ from: 0, to: after.length, insert: before }],
        },
      ]),
    )

    if (!silent) await workspace.open(path)
    return { path: relative, added: true }
  }

  const wasShowing = workspace.activeTabId

  if (append) {
    const { sync } = await import('../../sync-store/src/api')
    sync.mergeable(path)
  }

  const folder = folderOf(relative)
  await workspace.createNote(
    folder ? insideSpace(space.root, folder) : space.root,
    withExtension(nameOf(relative)),
  )

  const made = workspace.active
  if (content) {
    workspace.replace(content)
    await workspace.writeNow()
  }

  if (silent && made) {
    workspace.close(made.id)
    if (wasShowing !== null && workspace.tabs.some((tab) => tab.id === wasShowing)) {
      workspace.activate(wasShowing)
    }
  }

  return { path: relativeTo(space.root, made?.path ?? path), added: false }
}

export function appendNote(args: Said): Promise<unknown> {
  return newNote({ ...args, append: true, prepend: false })
}

function wroteTo(relative: string, count: number) {
  if (count === 0) throw new Error(`nothing was written to ${relative}`)
}

function joined(first: string, second: string): string {
  if (!first.trim()) return second
  if (!second.trim()) return first

  const rest = second.replace(/^\s+/, '')
  return `${first.replace(/\s+$/, '')}\n\n${rest}${rest.endsWith('\n') ? '' : '\n'}`
}

function prepended(before: string, content: string): string {
  const at = frontMatterBlock(before)?.to ?? 0
  const head = before.slice(0, at)

  return `${head}${head && !head.endsWith('\n') ? '\n' : ''}${joined(content, before.slice(at))}`
}

function wanted(args: Said): string {
  if (said(args, 'path') !== null) return withExtension(relativeIn(args))

  const name = said(args, 'name')
  if (!name) throw new Error('say a name or a path')

  const safe = relativeIn({ path: name }, 'path')
  if (safe.includes('/')) throw new Error('a name is not a path: use path for that')

  return withExtension(safe)
}

export async function searchSpace(args: Said): Promise<unknown> {
  await spaceFor(args)
  const query = said(args, 'query')
  if (!query) throw new Error('say what to search for')

  await runCommand({ id: 'search-space' })
  search.ask(query)

  const until = Date.now() + SEARCH_PATIENCE
  while (Date.now() < until) {
    await waited(LOOKING_AGAIN)
    if (!search.running) break
  }

  return {
    query,
    running: search.running,
    hits: search.hits
      .filter((hit) => protection.agentsMay(hit.path))
      .map((hit) => ({
        path: hit.path,
        name: hit.name,
        line: hit.line,
        text: hit.text,
      })),
  }
}

export async function runCommand(args: Said, road: Road = 'here'): Promise<unknown> {
  const id = said(args, 'id')
  if (!id) throw new Error('say which command')

  await commandRowsLoaded()
  const found = appCommands(views.of(workspace.panes.focusedId)).find((one) => one.id === id)
  if (!found) throw new Error(`there is no command called ${id}`)
  if (found.disabled === true) throw new Error(`${id} cannot run just now`)
  const kept = keptFromAgents(id, {
    front: protection.agentsMay(workspace.active?.path),
    space: protection.agentsMayAllOf(workspace.activeSpace?.root),
  })
  if (kept) throw new Error(kept)
  if (found.ownWindow === true) throw new Error(`${id} is not something the command line may run`)
  if (found.byHand === true && road === 'link') {
    throw new Error(`${id} is not something a link may run`)
  }

  found.run()
  return { id, label: found.label }
}

export async function writeFile(args: Said): Promise<unknown> {
  const space = await spaceToWrite(args)
  const relative = relativeIn(args)
  const path = insideSpace(space.root, relative)
  openToAgents(path, relative)
  const content = words(args, 'content')
  if (content === null) throw new Error('say the content')

  const before = await workspace.noteText(path)
  if (before === null)
    return { path: await madeFile(args, relative, content), written: content.length }

  wroteTo(
    relative,
    await workspace.replaceInNotes(
      [
        {
          path,
          before,
          after: content,
          edits: [{ from: 0, to: before.length, insert: content }],
          back: [{ from: 0, to: content.length, insert: before }],
        },
      ],
      { anyFile: true },
    ),
  )

  return { path: relative, written: content.length }
}

async function madeFile(args: Said, relative: string, content: string): Promise<string> {
  const folder = folderOf(relative)
  const name = nameToWrite(nameOf(relative), extensionOf(nameOf(relative), false))
  const named = folder ? `${folder}/${name}` : name

  if (isMarkdownPath(named)) {
    const made = (await newNote({ ...args, path: named, content })) as { path: string }
    return made.path
  }

  const space = await spaceToWrite(args)
  openToAgents(insideSpace(space.root, named), named)
  if (!(await writeIfAbsent(insideSpace(space.root, named), content))) {
    throw new Error(`${named} is already there`)
  }
  await workspace.loadTree()
  const { sync } = await import('../../sync-store/src/api')
  sync.nudge()

  return named
}

export async function moveFile(args: Said): Promise<unknown> {
  const space = await spaceToWrite(args)
  const from = relativeIn(args, 'path')
  const to = movedPath(from, relativeIn(args, 'to'))
  openToAgents(insideSpace(space.root, from), from)
  openToAgents(insideSpace(space.root, to), to)

  if ((await workspace.noteText(insideSpace(space.root, from))) === null) {
    throw new Error(`there is no note at ${from}`)
  }

  return { from, to: await movedIn(space.root, from, to) }
}

export async function deleteFile(args: Said): Promise<unknown> {
  const space = await spaceToWrite(args)
  const relative = relativeIn(args)
  const path = insideSpace(space.root, relative)
  openToAgents(path, relative)

  if ((await workspace.noteText(path)) === null) {
    throw new Error(`there is no note at ${relative}`)
  }
  if (workspace.keepsArchived(path)) throw new Error(`${relative} is archived, and is kept`)

  await workspace.remove(path, false)
  return { path: relative, deleted: true }
}

const BARE_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/

const LINKS = /^\[\[[^[\]]+\]\](?:\s*,\s*\[\[[^[\]]+\]\])*$/

function propertyEdit(text: string, key: string, value: string | null): TextEdit | null {
  if (value === null) return writeProperty(text, key, null)

  if (LINKS.test(value)) {
    const links = value.split(/\s*,\s*/)
    return links.length > 1 ? writeList(text, key, links) : writeProperty(text, key, value)
  }

  const items = writtenFlowItems(value)
  if (items)
    return writeList(
      text,
      key,
      items.map((one) => (isQuoted(one) ? unquoted(one) : typedItem(one))),
    )
  if (/^(true|false)$/i.test(value)) return writeProperty(text, key, value, 'checkbox')
  if (BARE_NUMBER.test(value)) return writeProperty(text, key, value, 'number')
  return writeProperty(text, key, value)
}

export async function setProperty(args: Said): Promise<unknown> {
  const note = await noteFor(args, 'path', true)
  if (!isMarkdownPath(note.path)) throw new Error(`${note.relative} is not a markdown note`)
  const key = said(args, 'key')
  if (!key) throw new Error('say which key')

  const value = said(args, 'value')
  const own = OWN_KEYS.find((one) => one === key.toLowerCase())
  if (own) {
    workspace.itemMeta.set(note.path, { [own]: value ? value.slice(0, LONGEST_META_VALUE) : null })
    return { path: note.relative, key: own, value, changed: true }
  }
  const edit = propertyEdit(note.text, key, value)
  if (!edit) return { path: note.relative, key, value, changed: false }

  const after = note.text.slice(0, edit.from) + edit.insert + note.text.slice(edit.to)
  wroteTo(
    note.relative,
    await workspace.replaceInNotes([
      {
        path: note.path,
        before: note.text,
        after,
        edits: [{ from: edit.from, to: edit.to, insert: edit.insert }],
        back: [
          {
            from: edit.from,
            to: edit.from + edit.insert.length,
            insert: note.text.slice(edit.from, edit.to),
          },
        ],
      },
    ]),
  )

  return { path: note.relative, key, value, changed: true }
}

export async function syncNow(): Promise<unknown> {
  const { sync } = await import('../../sync-store/src/api')
  const moved = await sync.pass()

  return { moved, status: sync.status, lastError: sync.lastError }
}

export async function publishNow(args: Said): Promise<unknown> {
  const status = await publishStatus(args)
  await syncNow()

  return status
}
