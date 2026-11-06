import { chooseFiles } from '../choose-files'
import { caughtFiles, type CaughtFiles } from '../drag-paths'
import { tidyPath, type Picked } from './sources'

export function pickFiles(): Promise<Picked[]> {
  return chooseFiles({ multiple: true })
}

export function pickFolder(): Promise<Picked[]> {
  return chooseFiles({ multiple: true, folder: true })
}

export async function droppedFiles(transfer: DataTransfer | null): Promise<Picked[]> {
  return transfer ? filesUnder(caughtFiles(transfer)) : []
}

export async function filesUnder({ entries, loose }: CaughtFiles): Promise<Picked[]> {
  if (!entries.length) return loose

  const found: Picked[] = []
  for (const entry of entries) await walk(entry, found)

  return found.length ? found : loose
}

const DEEPEST = 12

async function walk(entry: FileSystemEntry, found: Picked[], depth = 0) {
  if (depth > DEEPEST) return

  if (entry.isFile) {
    const file = await asFile(entry as FileSystemFileEntry)
    if (file) found.push(named(file, tidyPath(entry.fullPath)))
    return
  }

  for (const child of await children(entry as FileSystemDirectoryEntry)) {
    await walk(child, found, depth + 1)
  }
}

function asFile(entry: FileSystemFileEntry): Promise<File | null> {
  return new Promise((resolve) => {
    entry.file(resolve, () => resolve(null))
  })
}

function children(entry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  return new Promise((resolve) => {
    const reader = entry.createReader()
    const all: FileSystemEntry[] = []

    const more = () => {
      reader.readEntries(
        (batch) => {
          if (!batch.length) {
            resolve(all)
            return
          }

          all.push(...batch)
          more()
        },
        () => resolve(all),
      )
    }

    more()
  })
}

function named(file: File, path: string): Picked {
  return {
    name: file.name,
    webkitRelativePath: path,
    arrayBuffer: () => file.arrayBuffer(),
  }
}
