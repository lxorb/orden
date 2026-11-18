import { readProperties } from '@orden/markdown/properties'
import { commandRowsLoaded } from '@orden/contracts'
import { appCommands } from '../../commands/src/api'
import { links } from '../../link-index/src/api'
import { countText, scanHeadings } from '../../documents/src/api'
import { relativeTo, currentWindow } from '../../platform/src/api'
import { views } from '../../panes/src/api'
import { workspace } from '../../workspace/src/api'
import type { Said } from './args'
import { type Note, noteFor, spaceFor } from './space'

const onNote =
  (answer: (note: Note) => object | Promise<object>) =>
  async (args: Said): Promise<unknown> => {
    const note = await noteFor(args)
    return { path: note.relative, ...(await answer(note)) }
  }

export async function listFiles(args: Said): Promise<unknown> {
  const space = await spaceFor(args)

  return {
    space: space.name,
    files: workspace.files.map((one) => ({
      path: relativeTo(space.root, one.path),
      name: one.name,
      modified: one.modified,
      created: one.created,
    })),
  }
}

export const readFile = onNote((note) => ({ text: note.text }))

export const listLinks = onNote(async (note) => {
  await links.scanned()
  return { links: links.outgoing(note.path) }
})

export const listBacklinks = onNote(async (note) => {
  await links.scanned()
  return { backlinks: links.backlinks(note.path) }
})

export async function listOrphans(args: Said): Promise<unknown> {
  await spaceFor(args)
  await links.scanned()

  return {
    orphans: links.graph.nodes
      .filter((node) => node.path !== null && node.degree === 0)
      .map((node) => ({ path: node.path, name: node.name })),
  }
}

export async function listTags(args: Said): Promise<unknown> {
  await spaceFor(args)
  await workspace.loadTags()

  return { tags: workspace.tags }
}

export const readNoteProperties = onNote((note) => ({
  properties: readProperties(note.text) ?? [],
}))

export const readOutline = onNote((note) => ({ headings: scanHeadings(note.text) }))

export async function listBookmarks(args: Said): Promise<unknown> {
  const space = await spaceFor(args)
  return { bookmarks: workspace.bookmarks.of(space.root) }
}

export const countWords = onNote((note) => countText(note.text))

export async function listCommands(): Promise<unknown> {
  await commandRowsLoaded()
  return {
    commands: appCommands(views.of(workspace.panes.focusedId))
      .filter((one) => one.ownWindow !== true)
      .map((one) => ({
        id: one.id,
        label: one.label,
        hint: one.hint ?? null,
        disabled: one.disabled === true,
        checked: one.checked === true,
      })),
  }
}

export async function syncStatus(): Promise<unknown> {
  const { sync } = await import('../../sync-store/src/api')

  return {
    status: sync.status,
    lastError: sync.lastError,
    lastSyncedAt: sync.lastSyncedAt,
  }
}

export async function publishStatus(args: Said): Promise<unknown> {
  const space = await spaceFor(args)
  const [{ account }, { sync }] = await Promise.all([
    import('../../accounts/src/api'),
    import('../../sync-store/src/api'),
  ])

  const id = sync.remoteIdFor(space.root)
  const blog = id === null ? undefined : account.spaces.find((one) => one.id === id)?.blog

  return {
    space: space.name,
    published: blog?.enabled === true,
    subdomain: blog?.subdomain ?? null,
    domain: blog?.domain ?? null,
    note: blog?.note ?? null,
  }
}

export async function windowRect(): Promise<unknown> {
  const window = await currentWindow()
  const [position, size, scale] = await Promise.all([
    window.outerPosition(),
    window.outerSize(),
    window.scaleFactor(),
  ])

  return { x: position.x, y: position.y, width: size.width, height: size.height, scale }
}
