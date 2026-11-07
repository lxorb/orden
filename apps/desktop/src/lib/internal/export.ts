import type { ItemMeta } from '@orden/sync-core/meta'
import { invoke as crate } from '../native'
import { joinPath } from '../tauri'
import { mountOf } from './roots'

interface Listed {
  path: string
  is_dir: boolean
  children?: Listed[]
}

async function filesOf(root: string): Promise<{ path: string; read: () => Promise<Uint8Array> }[]> {
  const kept = mountOf(root)
  if (kept) {
    const folder = kept.mount.folder
    return (await folder.list()).flatMap(({ path, entry }) =>
      entry.key
        ? [
            {
              path,
              read: async () => {
                const bytes = await folder.read(path)
                if (!bytes) throw new Error(`${path} could not be read`)
                return bytes
              },
            },
          ]
        : [],
    )
  }
  const tree = await crate<Listed>('read_tree', {
    root,
    options: { every: true, papers: true, showHidden: false },
  })
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const out: { path: string; read: () => Promise<Uint8Array> }[] = []
  const walk = (node: Listed) => {
    for (const child of node.children ?? []) {
      if (child.is_dir) walk(child)
      else {
        out.push({
          path: child.path.replace(/\\/g, '/').slice(base.length + 1),
          read: async () =>
            new Uint8Array(await crate<ArrayBuffer>('read_file', { path: child.path })),
        })
      }
    }
  }
  walk(tree)
  const inbox = joinPath(root, '.Inbox.md')
  if (await crate<unknown>('file_stamp', { path: inbox }).catch(() => null)) {
    out.push({
      path: '.Inbox.md',
      read: async () => new Uint8Array(await crate<ArrayBuffer>('read_file', { path: inbox })),
    })
  }
  return out
}

async function freeFolder(picked: string, name: string): Promise<string> {
  const taken = (path: string) => crate<boolean>('path_taken', { path }).catch(() => true)
  const first = joinPath(picked, name)
  if (!(await taken(first))) return first
  for (let counter = 2; ; counter += 1) {
    const one = joinPath(picked, `${name} ${String(counter)}`)
    if (!(await taken(one))) return one
  }
}

type MetaOf = (path: string) => ItemMeta | null

type ListedOf = (path: string) => boolean

async function bytesOut(
  file: { path: string; read: () => Promise<Uint8Array> },
  metaOf: MetaOf,
  listedOf: ListedOf,
) {
  const bytes = await file.read()
  if (!/\.(md|markdown)$/i.test(file.path)) return bytes
  const meta = metaOf(file.path)
  const listed = listedOf(file.path)
  if (!meta && !listed) return bytes
  const { keptText } = await import('../export/kept')
  const text = new TextDecoder().decode(bytes)
  const written = await keptText(text, meta, listed)
  return written === text ? bytes : new TextEncoder().encode(written)
}

function inboxName(files: readonly { path: string }[]): string {
  const taken = new Set(files.map((one) => one.path.toLowerCase()))
  for (let counter = 1; ; counter += 1) {
    const name = counter === 1 ? 'Inbox.md' : `Inbox ${String(counter)}.md`
    if (!taken.has(name.toLowerCase())) return name
  }
}

export async function exportSpaceTo(
  root: string,
  name: string,
  picked: string,
  metaOf: MetaOf = () => null,
  listedOf: ListedOf = () => false,
  inbox: string | null = null,
): Promise<string> {
  const into = await freeFolder(picked, name)
  const files = await filesOf(root)
  for (const file of files) {
    const path = joinPath(into, file.path)
    await crate('write_bytes', { path, bytes: await bytesOut(file, metaOf, listedOf) })
  }
  if (inbox !== null && inbox !== '') {
    const path = joinPath(into, inboxName(files))
    await crate('write_bytes', { path, bytes: new TextEncoder().encode(inbox) })
  }
  return into
}

export async function exportSpace(
  root: string,
  name: string,
  metaOf: MetaOf = () => null,
  listedOf: ListedOf = () => false,
  inbox: string | null = null,
): Promise<string | null> {
  const given = (await import('../dialog-answer')).dialogAnswer()
  const picked = given
    ? await given(true)
    : await (await import('@tauri-apps/plugin-dialog')).open({ directory: true })
  if (typeof picked !== 'string') return null
  return exportSpaceTo(root, name, picked, metaOf, listedOf, inbox)
}
