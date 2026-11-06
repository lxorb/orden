import { INBOX_PATH } from '@orden/bases/inbox'
import { api, BASE } from '../api'
import { fileBytes, sha256, toBase64 } from '../bytes'
import { deviceName } from '../device'
import { keptShaped, mountOf } from '../internal/roots'
import { mountedFor } from '../internal/watch'
import { links } from '../link-index.svelte'
import { evictedHere } from '../icloud-placeholder'
import { onDisk } from '../on-disk'
import { holderOf } from '../pages/held'
import { scanSpace } from '../space-watch'
import { windowsPath } from './places'
import { invoke, isDesktop, isNative, joinPath, platform } from '../tauri'
import { classifier } from './classify'
import { accountOver, type Reading, readingOver, remoteFiles } from './transport'
import type { Disk, FileKind, World } from './world'
import { syncDeletes } from '../sync/deletes'

export interface Telling {
  holdingWrites(from: string, run: () => Promise<void>, stalled: () => Promise<void>): Promise<void>
  moved(from: string, to: string, kind: FileKind): Promise<void>
  gone(path: string, kind: FileKind): Promise<void>
  written(path: string, fresh: boolean): void
  writing?(path: string, text: string, write: () => Promise<unknown>): Promise<unknown>
}

function parentOf(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at > 0 ? path.slice(0, at) : path
}

const RAW = isNative ? {} : { raw: true }

const stamped = (path: string) =>
  isNative
    ? onDisk(path)
    : invoke<unknown>('path_exists', { path, ...RAW }).then(
        (there) => there === true,
        () => false,
      )

const thereOrUnsure = (path: string): Promise<boolean> =>
  isNative ? invoke<boolean>('file_there', { path }).catch(() => true) : stamped(path)

function diskOf(telling: Telling): Disk {
  return {
    read: (path) => invoke<string>('read_note', { path, ...RAW }).catch(() => null),
    async write(path, text) {
      const fresh = !(await stamped(path))
      await invoke('create_folder', { path: parentOf(path), arrived: true }).catch(() => undefined)
      const write = () => invoke('write_note', { path, content: text, arrived: true })
      await (telling.writing ? telling.writing(path, text, write) : write())
      links.noteSaved(path, text)
      telling.written(path, fresh)
    },
    keep: (path, text) =>
      invoke('snapshot_note', { path, content: text }).then(
        () => undefined,
        () => undefined,
      ),
    async move(from, to, kind) {
      await invoke('create_folder', { path: parentOf(to), arrived: true }).catch(() => undefined)
      const hold = kind === 'file' && holderOf(to) !== null
      await telling.holdingWrites(
        from,
        async () => {
          await invoke('rename_note', {
            from,
            to,
            alone: true,
            arrived: true,
            ...(hold ? { hold } : {}),
            ...RAW,
          })
          await telling.moved(from, to, kind)
        },
        () => Promise.reject(new Error(`${from} has a write that has not answered`)),
      )
    },
    async remove(path, kind) {
      if (kind === 'file') {
        const words = await invoke<string>('read_note', { path, ...RAW }).catch(() => null)
        if (words?.trim())
          await invoke('snapshot_note', { path, content: words }).catch(() => undefined)
      }
      if (syncDeletes(path, kind)) await invoke('delete_note', { path })
      else
        await invoke('trash_item', {
          path,
          kind: kind === 'folder' ? 'folder' : 'note',
          alone: true,
        })
      await telling.gone(path, kind)
    },
    mkdir: (path) => invoke('create_folder', { path, arrived: true }).then(() => undefined),
    exists: thereOrUnsure,
    evicted: evictedHere,
  }
}

export const lettingGo = {
  drop: (path: string) => invoke('let_go_note', { path }).then(() => undefined),
}

interface Listed {
  path: string
  is_dir: boolean
  unlisted?: boolean
  children?: Listed[]
}

async function listed(root: string): Promise<{ path: string; dir: boolean }[] | null> {
  const slashed = (path: string) => (windowsPath(root) ? path.replace(/\\/g, '/') : path)
  const base = slashed(root).replace(/\/+$/, '')
  const inside = (path: string): string | null => {
    const at = slashed(path)
    return at.startsWith(`${base}/`) ? at.slice(base.length + 1) : null
  }
  const kept = (await mountedFor(root)) ? mountOf(root) : null
  if (!kept && keptShaped(root)) throw new Error(`${root} is a space kept here, not mounted`)
  if (kept) {
    const top = kept.inside ? `${kept.inside}/` : ''
    return (await kept.mount.folder.list()).flatMap(({ path, entry }) =>
      path.startsWith(top) && path !== kept.inside
        ? [{ path: path.slice(top.length), dir: !entry.key }]
        : [],
    )
  }
  if (isDesktop) {
    const all = await scanSpace(root).catch(() => null)
    if (all) {
      return all.flatMap((one) => {
        const path = inside(one.path)
        return path === null ? [] : [{ path, dir: one.dir }]
      })
    }
  }
  const tree = await invoke<Listed>('read_tree', {
    root,
    options: { showHidden: false, papers: true },
    ...RAW,
  }).catch(() => null)
  const out: { path: string; dir: boolean }[] = []
  const walk = (node: Listed) => {
    for (const child of node.children ?? []) {
      const path = inside(child.path)
      if (path === null) continue
      out.push({ path, dir: child.is_dir })
      if (child.is_dir) walk(child)
    }
  }
  if (!tree || tree.unlisted) return null
  walk(tree)
  const inbox = `${base}/${INBOX_PATH}`
  if (!out.some((one) => one.path === INBOX_PATH) && (await stamped(inbox).catch(() => false))) {
    out.push({ path: INBOX_PATH, dir: false })
  }
  return out
}

function reachingOf(token: () => string | null) {
  return { base: BASE, token, device: deviceName, fetch: (request: Request) => fetch(request) }
}

export function readingFor(token: () => string | null): Reading {
  return readingOver(reachingOf(token))
}

export function appWorld(token: () => string | null, telling: Telling): World {
  const os = platform()
  const reaching = reachingOf(token)
  return {
    disk: diskOf(telling),
    account: accountOver(reaching),
    name: deviceName(),
    now: () => Date.now(),
    random: () => (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) / 0x100000000,
    digest: (text) => sha256(text),
    join: joinPath,
    foldsCase: os === 'windows' || os === 'macos' || os === 'ios' || os === '',
    platform: os === 'windows' ? 'windows' : os === 'macos' || os === 'ios' ? 'mac' : 'other',
    list: listed,
    classify: classifier(),
    lazy: !isNative,
    blobs: {
      async read(path) {
        return await fileBytes(path).catch(() => null)
      },
      async size(path) {
        const stamp = await invoke<{ len: number } | null>('file_stamp', { path }).catch(() => null)
        return stamp?.len ?? null
      },
      async write(path, bytes) {
        const fresh = !(await stamped(path))
        await invoke('create_folder', { path: parentOf(path), arrived: true }).catch(
          () => undefined,
        )
        await invoke('write_bytes', { path, base64: toBase64(bytes) })
        telling.written(path, fresh)
      },
      hash: (bytes) => sha256(bytes),
      ...remoteFiles(reaching),
    },
    async ancestor(id, hash) {
      const session = token()
      if (!session) return null
      const { versions } = await api.noteVersions(session, id).catch(() => ({ versions: [] }))
      for (const version of versions.slice(0, 20)) {
        const body = await api.noteVersion(session, id, version.at).catch(() => null)
        if (body && (await sha256(body.content.replace(/\r\n?/g, '\n'))) === hash)
          return body.content
        if (body && (await sha256(body.content)) === hash) return body.content
      }
      return null
    },
  }
}
