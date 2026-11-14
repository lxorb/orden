import { readProperties } from '@orden/markdown/properties'
import { appCommands } from '../commands'
import { countText } from '../counts'
import { links } from '../link-index.svelte'
import { scanHeadings } from '../outline'
import { relativeTo } from '../space-paths'
import { currentWindow } from '../tauri'
import { views } from '../views.svelte'
import { workspace } from '../workspace.svelte'
import type { Said } from './args'
import { noteFor, spaceFor } from './space'

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

export async function readFile(args: Said): Promise<unknown> {
  const note = await noteFor(args)
  return { path: note.relative, text: note.text }
}

export async function listLinks(args: Said): Promise<unknown> {
  const note = await noteFor(args)
  return { path: note.relative, links: links.outgoing(note.path) }
}

export async function listBacklinks(args: Said): Promise<unknown> {
  const note = await noteFor(args)
  return { path: note.relative, backlinks: links.backlinks(note.path) }
}

export async function listOrphans(args: Said): Promise<unknown> {
  await spaceFor(args)

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

export async function readNoteProperties(args: Said): Promise<unknown> {
  const note = await noteFor(args)

  return { path: note.relative, properties: readProperties(note.text) ?? [] }
}

export async function readOutline(args: Said): Promise<unknown> {
  const note = await noteFor(args)
  return { path: note.relative, headings: scanHeadings(note.text) }
}

export async function listBookmarks(args: Said): Promise<unknown> {
  const space = await spaceFor(args)
  return { bookmarks: workspace.bookmarks.of(space.root) }
}

export async function countWords(args: Said): Promise<unknown> {
  const note = await noteFor(args)
  return { path: note.relative, ...countText(note.text) }
}

export function listCommands(): unknown {
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
  const { sync } = await import('../sync.svelte')

  return {
    status: sync.status,
    lastError: sync.lastError,
    lastSyncedAt: sync.lastSyncedAt,
  }
}

export async function publishStatus(args: Said): Promise<unknown> {
  const space = await spaceFor(args)
  const [{ account }, { sync }] = await Promise.all([
    import('../accounts/src/api'),
    import('../sync.svelte'),
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
