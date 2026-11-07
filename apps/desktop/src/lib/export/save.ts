import { downloadStarted } from '../downloads/started'
import { keep, storedText } from '../stored'
import { folderOf, nameOf } from '../space-paths'
import { invoke, isDesktop, isMobile, isNative, joinPath } from '../tauri'
import { writeBytes, writeFile as writeText } from '../workspace/write-file'
import { numbered } from '@orden/markdown/paths'
import { fileNameFor, freeName, stemOf } from './naming'

export type Payload =
  | { text: string; mime: string }
  | { bytes: Uint8Array; mime: string }
  | {
      files: readonly { path: string; body: string | Uint8Array }[]
      folder: boolean
      relink?: (landed: ReadonlyMap<string, string>) => string | Uint8Array
    }

const FOLDER_KEY = 'orden:export-folder'

const EXPORTS = 'Exports'

function remember(target: string) {
  const folder = folderOf(target)
  if (folder) keep(FOLDER_KEY, folder)
}

export async function chooseTarget(
  name: string,
  extension: string,
  label: string,
): Promise<string | null> {
  const given = (await import('../dialog-answer')).dialogAnswer()
  if (given) {
    const chosen = await given(true)
    if (chosen) downloadStarted(nameOf(chosen))
    return chosen
  }

  const { save } = await import('@tauri-apps/plugin-dialog')
  const file = fileNameFor(name, extension)
  const folder = storedText(FOLDER_KEY)

  const target = await save({
    defaultPath: folder ? joinPath(folder, file) : file,
    filters: [{ name: label, extensions: [extension] }],
  })
  if (target) downloadStarted(nameOf(target))
  return target
}

export function download(name: string, payload: Payload) {
  if ('files' in payload) return

  const blob =
    'text' in payload
      ? new Blob([payload.text], { type: payload.mime })
      : new Blob([payload.bytes.slice()], { type: payload.mime })

  handOver(name, blob)
}

export function handOver(name: string, blob: Blob) {
  downloadStarted(name)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function writeFile(path: string, body: string | Uint8Array): Promise<void> {
  if (typeof body === 'string') return writeText(path, body)

  return writeBytes(path, body)
}

export function insideFolder(path: string): boolean {
  if (/^(?:[A-Za-z]:|[\\/])/.test(path)) return false
  return !path.split(/[\\/]/).includes('..')
}

async function taken(path: string): Promise<boolean> {
  return invoke<boolean>('path_taken', { path })
}

async function freeBeside(folder: string, path: string, claimed: Set<string>): Promise<string> {
  for (let counter = 1; ; counter += 1) {
    const candidate = numbered(path, counter)
    const full = joinPath(folder, candidate)
    if (claimed.has(full.toLowerCase()) || (await taken(full))) continue

    claimed.add(full.toLowerCase())
    return candidate
  }
}

async function writeBeside(
  target: string,
  payload: Extract<Payload, { files: unknown }>,
): Promise<void> {
  const [first, ...rest] = payload.files
  if (!first) return

  const folder = folderOf(target)
  const from = `${stemOf(first.path)} `
  const to = `${stemOf(nameOf(target))} `
  const claimed = new Set([target.toLowerCase()])
  const landed = new Map<string, string>()

  for (const file of rest) {
    if (!insideFolder(file.path)) continue

    const wanted = file.path.startsWith(from) ? to + file.path.slice(from.length) : file.path
    const path = await freeBeside(folder, wanted, claimed)
    if (path !== file.path) landed.set(file.path, path)
    await writeFile(joinPath(folder, path), file.body)
  }

  await writeFile(target, payload.relink && landed.size > 0 ? payload.relink(landed) : first.body)
}

async function writePayload(target: string, payload: Payload): Promise<void> {
  if ('files' in payload) {
    if (!payload.folder) return writeBeside(target, payload)

    for (const file of payload.files) {
      if (insideFolder(file.path)) await writeFile(joinPath(target, file.path), file.body)
    }
    return
  }

  await writeFile(target, 'text' in payload ? payload.text : payload.bytes)
}

async function reveal(target: string): Promise<void> {
  if (!isDesktop) return

  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  await revealItemInDir(target).catch(() => undefined)
}

async function namesIn(folder: string): Promise<Set<string>> {
  interface Entry {
    name: string
    children: Entry[]
  }

  const tree = await invoke<Entry>('read_tree', { root: folder }).catch(() => null)
  return new Set((tree?.children ?? []).map((child) => child.name))
}

async function saveOnPhone(file: string, payload: Payload): Promise<string> {
  const root = await invoke<string>('spaces_root')
  const folder = joinPath(root, EXPORTS)
  const target = joinPath(folder, freeName(file, await namesIn(folder)))

  downloadStarted(nameOf(target))
  await writePayload(target, payload)
  return target
}

export async function deliver(
  name: string,
  extension: string,
  label: string,
  payload: Payload,
): Promise<string | null> {
  const file = fileNameFor(name, extension)

  if (!isNative) {
    download(file, payload)
    return file
  }

  if (isMobile) return saveOnPhone(file, payload)

  const target = await chooseTarget(name, extension, label)
  if (!target) return null

  await writePayload(target, payload)
  remember(target)
  await reveal(target)

  return target
}
