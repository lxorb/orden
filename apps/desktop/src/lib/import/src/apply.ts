import { freePath } from '@orden/markdown/paths'

import { insideOnly, log, onDisk, joinPath, sha256 } from '../../platform/src/api'
import { holderOf, pairOf, paperOf } from '@orden/markdown/pages'
import { workspace } from '../../workspace.svelte'
import { writeBytes, writeFile } from '../../workspace/write-file'

import { nameKey } from './names'
import type { ImportPlan, Planned } from './plan'
import { canvasFollowed, isCanvas, linksFollowed } from './rewrite'

type Written = Pick<ImportPlan, 'files'>

export interface ImportTarget {
  root: string
  folder: string
}

export interface Landed {
  paths: string[]
  stepped: number
}

export interface Writing {
  onWritten?: (done: number, total: number) => void
}

export async function applyImport(
  plan: Written,
  target: ImportTarget,
  options: Writing = {},
): Promise<Landed> {
  const { canWriteAt } = await import('../../sharing/src/api')
  const into = target.folder ? joinPath(target.root, target.folder) : target.root
  if (!canWriteAt(into)) throw new Error(UNWRITABLE)

  const { files, stepped } = await restampedOnDisk(plan, target)
  const paths: string[] = []
  const wrote: Record<string, string> = {}
  let done = 0

  try {
    for (const file of files) {
      const path = joinPath(target.root, file.path)

      if (file.kind === 'note') {
        await writeFile(path, file.text)
        wrote[path] = await sha256(file.text)
      } else await writeBytes(path, file.bytes)

      paths.push(...(file.kind === 'file' && file.pages ? await asPages(path) : [path]))
      done += 1
      options.onWritten?.(done, files.length)
    }
  } finally {
    if (paths.length) await landed(paths, wrote)
  }

  return { paths, stepped }
}

async function asPages(path: string): Promise<string[]> {
  return [(await workspace.pageNoteForPdf(path)) ?? path]
}

async function landed(paths: string[], wrote: Record<string, string>) {
  workspace.undone.record({ kind: 'import', paths, wrote })
  for (const path of paths) await workspace.fileCame(path, 'file')
  await workspace.loadTree()
  const { sync } = await import('../../sync.svelte')
  sync.nudge()
}

function judged(files: readonly Planned[]): Planned[] {
  return files.map((file) => {
    const inside = insideOnly(file.path)
    if (inside === null) {
      log('error', `import: ${file.path} is not a path inside a space, so nothing was written`)
      throw new Error(ESCAPING)
    }

    return { ...file, path: inside }
  })
}

const UNWRITABLE = 'That import could not be written.'

const ESCAPING = 'That import would have landed outside the space, so nothing was written.'

async function restampedOnDisk(
  plan: Written,
  target: ImportTarget,
): Promise<{ files: Planned[]; stepped: number }> {
  const taken = takenIn(target)
  const there = new Map<string, boolean>()

  for (;;) {
    const stamped = restamped(plan, taken, target.folder)
    const files = judged(stamped.files)

    const coming = new Set(files.map((file) => nameKey(file.path)))
    const partner = (path: string) => {
      const other = pairOf(path)
      return other !== null && !coming.has(nameKey(other)) ? other : null
    }
    const asked = files.flatMap((file) => {
      const other = partner(file.path)
      return other === null ? [file.path] : [file.path, other]
    })
    const asking = [...new Set(asked)].filter((path) => !there.has(path))
    const answers = await Promise.all(asking.map((path) => onDisk(joinPath(target.root, path))))
    asking.forEach((path, at) => there.set(path, answers[at] === true))

    const held = files.filter((file) => {
      const other = partner(file.path)
      return there.get(file.path) === true || (other !== null && there.get(other) === true)
    })
    if (!held.length) return { files, stepped: stamped.stepped }
    for (const file of held) taken.add(nameKey(file.path))
  }
}

function takenIn(target: ImportTarget): Set<string> {
  const taken = new Set<string>()
  const root = target.root

  for (const entry of workspace.files) {
    if (!entry.path.startsWith(root)) continue
    taken.add(
      nameKey(
        entry.path
          .slice(root.length)
          .replace(/^[\\/]+/, '')
          .replace(/\\/g, '/'),
      ),
    )
  }

  return taken
}

export function restamped(
  plan: Written,
  taken: ReadonlySet<string>,
  folder: string,
): { files: Planned[]; stepped: number } {
  const under = folder.replace(/^\/+|\/+$/g, '')
  const there = new Set([...taken].map(nameKey))
  const held = new Set(there)
  const moved = new Map<string, string>()
  const placed = new Map<Planned, string>()
  const inside = (path: string) => (under ? `${under}/${path}` : path)

  const clashes = (candidate: string) => {
    const other = pairOf(candidate)
    return held.has(nameKey(candidate)) || (other !== null && there.has(nameKey(other)))
  }

  const filled = new Set<string>()
  for (const file of plan.files) {
    const parts = file.path.split('/').slice(0, -1)
    parts.forEach((_, at) => filled.add(nameKey(parts.slice(0, at + 1).join('/'))))
  }
  const holds = (folder: string) => {
    const key = `${nameKey(folder)}/`
    return [...held].some((one) => one.startsWith(key))
  }
  const folders = new Map<string, string>()
  const into = (path: string) => {
    const parts = path.split('/')
    for (let at = parts.length - 1; at > 0; at -= 1) {
      const folder = folders.get(nameKey(parts.slice(0, at).join('/')))
      if (folder !== undefined) return [folder, ...parts.slice(at)].join('/')
    }
    return path
  }
  const notes = new Map<Planned, string>()
  const folderNotes = plan.files
    .filter((file) => file.kind === 'note' && filled.has(nameKey(file.path.replace(/\.md$/i, ''))))
    .sort((one, two) => one.path.split('/').length - two.path.split('/').length)
  for (const file of folderNotes) {
    const wanted = into(inside(file.path))
    const free = freePath(
      wanted,
      (candidate) => clashes(candidate) || holds(candidate.replace(/\.md$/i, '')),
    )
    held.add(nameKey(free))
    notes.set(file, free)
    folders.set(nameKey(inside(file.path).replace(/\.md$/i, '')), free.replace(/\.md$/i, ''))
  }

  const coming = new Set(plan.files.map((file) => nameKey(file.path)))
  const following = (file: Planned) => {
    const holder = holderOf(file.path)
    return holder !== null && coming.has(nameKey(holder))
  }
  const landedAt = new Map<string, string>()

  for (const file of [
    ...plan.files.filter((one) => !following(one)),
    ...plan.files.filter(following),
  ]) {
    const wanted = inside(file.path)
    const holder = holderOf(file.path)
    const note = holder === null ? undefined : landedAt.get(nameKey(holder))
    const free =
      notes.get(file) ?? freePath(note === undefined ? into(wanted) : paperOf(note), clashes)
    held.add(nameKey(free))
    landedAt.set(nameKey(file.path), free)

    if (free !== wanted) moved.set(file.path, under ? free.slice(under.length + 1) : free)
    placed.set(file, free)
  }

  const paths = plan.files.map((file) => file.path)
  const files = plan.files.map((file) => {
    const was = file.path
    const now = placed.get(file) ?? was
    if (file.kind === 'file') {
      const bytes = moved.size && isCanvas(was) ? canvasFollowed(file.bytes, moved) : file.bytes
      return { ...file, path: now, bytes }
    }
    const text = moved.size ? linksFollowed(file.text, was, moved, paths) : file.text
    return { ...file, path: now, text }
  })

  return { files, stepped: moved.size }
}
