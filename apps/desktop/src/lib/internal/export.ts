import { toBase64 } from '../bytes'
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

export async function exportSpaceTo(root: string, name: string, picked: string): Promise<string> {
  const into = await freeFolder(picked, name)
  for (const file of await filesOf(root)) {
    const path = joinPath(into, file.path)
    await crate('write_bytes', { path, base64: toBase64(await file.read()) })
  }
  return into
}

export async function exportSpace(root: string, name: string): Promise<string | null> {
  const given = (await import('../dialog-answer')).dialogAnswer()
  const picked = given
    ? await given(true)
    : await (await import('@tauri-apps/plugin-dialog')).open({ directory: true })
  if (typeof picked !== 'string') return null
  return exportSpaceTo(root, name, picked)
}
