/** A whole space written out as Markdown and folders, into a folder the reader picks
 *  (#1068, step 4f): the one way a space Orden keeps itself becomes files anybody else
 *  can read, made when it is asked for and never kept in step after. Every note, every
 *  picture and PDF, each where it is in the space and under its own name, and the
 *  space's inbox too, which no list shows (#1044). A folder space is written out the
 *  same way, from its own folder.
 *
 *  Into a folder of its own inside the one picked, named as the space, or `name 2` where
 *  that is taken: nothing already there is written over. The crate writes there because
 *  the folder was picked in its own dialog, which is the one way out of the spaces it
 *  allows. A folder with nothing in it has no file to be written, so it is not. */

import { toBase64 } from '../bytes'
import { invoke as crate } from '../native'
import { joinPath } from '../tauri'
import { mountOf } from './roots'

interface Listed {
  path: string
  is_dir: boolean
  children?: Listed[]
}

/** Every file of the space at `root`, by where it is inside, with how to read it. */
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

/** A folder for `name` inside `picked` that nothing is at yet. */
async function freeFolder(picked: string, name: string): Promise<string> {
  const taken = (path: string) => crate<boolean>('path_taken', { path }).catch(() => true)
  const first = joinPath(picked, name)
  if (!(await taken(first))) return first
  for (let counter = 2; ; counter += 1) {
    const one = joinPath(picked, `${name} ${String(counter)}`)
    if (!(await taken(one))) return one
  }
}

/** The space at `root`, named `name`, written out into `picked`. Answers the folder it
 *  was written into. */
export async function exportSpaceTo(root: string, name: string, picked: string): Promise<string> {
  const into = await freeFolder(picked, name)
  for (const file of await filesOf(root)) {
    const path = joinPath(into, file.path)
    await crate('write_bytes', { path, base64: toBase64(await file.read()) })
  }
  return into
}

/** The same, into a folder the reader picks now - or, for an agent's command, the
 *  folder its path names, which the crate has judged as the dialog's pick (#1078,
 *  `dialog-answer.ts`). Null where none was picked. */
export async function exportSpace(root: string, name: string): Promise<string | null> {
  const given = (await import('../dialog-answer')).dialogAnswer()
  const picked = given
    ? await given(true)
    : await (await import('@tauri-apps/plugin-dialog')).open({ directory: true })
  if (typeof picked !== 'string') return null
  return exportSpaceTo(root, name, picked)
}
