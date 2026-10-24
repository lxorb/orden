/** Where a finished export ends up, which is the one part of exporting that is
 *  different on all three builds.
 *
 *  The desktop asks, in the system's own save dialog, starting in the folder the
 *  last export went to - nobody keeps their documents somewhere new each time.
 *  The browser hands the bytes to itself to download, because a page may not
 *  write a file. A phone has neither a dialog nor a downloads folder, so the file
 *  is written into the app's own documents folder, where the system's Files app
 *  can reach it.
 *
 *  Text and bytes take the same road. DOCX, ePub, JPG, PNG, a TextPack and the
 *  pictures inside a TextBundle are bytes, and `write_bytes` in the crate is the
 *  text writer's twin: the same path check, the same atomic write. */

import { toBase64 } from '../bytes'
import { keep, storedText } from '../stored'
import { folderOf, nameOf } from '../space-paths'
import { invoke, isDesktop, isMobile, isNative, joinPath } from '../tauri'
import { writeBytes, writeFile as writeText } from '../workspace/write-file'
import { numbered } from '@nib/markdown/paths'
import { fileNameFor, freeName, stemOf } from './naming'

/** What a converter produced. Text where the format is text, so a note that is
 *  written out as markdown is byte for byte what the editor holds. */
export type Payload =
  | { text: string; mime: string }
  | { bytes: Uint8Array; mime: string }
  /** Several files at once. `folder` says what the chosen target is: the folder
   *  they all go inside, which is what a `.textbundle` is, or the first file
   *  itself, with the rest landing beside it - a note and its `assets`.
   *
   *  The rest are the export's own additions to a folder the reader did not
   *  empty for them, so one whose name is taken steps aside rather than writing
   *  over what is there. `relink` is how the first file is told where they
   *  landed: handed each moved path's new spelling, it answers the first file's
   *  body again, pointing at them. */
  | {
      files: readonly { path: string; body: string | Uint8Array }[]
      folder: boolean
      relink?: (landed: ReadonlyMap<string, string>) => string | Uint8Array
    }

/** Where the last export was written, remembered so the next one starts there. */
const FOLDER_KEY = 'nib:export-folder'

/** The folder inside the app's documents folder a phone writes exports into. */
const EXPORTS = 'Exports'

function remember(target: string) {
  const folder = folderOf(target)
  // Worth nothing, and never worth failing an export over.
  if (folder) keep(FOLDER_KEY, folder)
}

/** The save dialog, opened on the remembered folder. Answers null when the
 *  reader closes it, which is a cancelled export and not a failure. */
export async function chooseTarget(
  name: string,
  extension: string,
  label: string,
): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog')
  const file = fileNameFor(name, extension)
  // A browser told to keep no site data starts wherever the dialog last was.
  const folder = storedText(FOLDER_KEY)

  return save({
    defaultPath: folder ? joinPath(folder, file) : file,
    filters: [{ name: label, extensions: [extension] }],
  })
}

/** A browser has no file dialog to offer; the file is handed to it to save. */
export function download(name: string, payload: Payload) {
  // A browser cannot be handed a folder, so nothing gives it one: a TextBundle
  // is zipped into a TextPack before it gets here. See run.ts.
  if ('files' in payload) return

  const blob =
    'text' in payload
      ? new Blob([payload.text], { type: payload.mime })
      : // A fresh buffer, because a `Uint8Array` over a shared one is a view and
        // Blob would take the whole buffer behind it.
        new Blob([payload.bytes.slice()], { type: payload.mime })

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** One file onto the disk, text as text and bytes as bytes. Through the app's one
 *  write path, so an export saved into a space is a file its links reach at once;
 *  see workspace/write-file.ts. */
export async function writeFile(path: string, body: string | Uint8Array): Promise<void> {
  if (typeof body === 'string') return writeText(path, body)

  // Base64 rather than an array of numbers: a two megabyte picture as JSON
  // digits is twenty megabytes of text for the bridge to parse.
  return writeBytes(path, toBase64(body))
}

/** Whether a path out of a payload names one file under the folder it is joined
 *  onto, rather than a way out of it.
 *
 *  A package's paths are partly the note's own words - a picture is called after
 *  the `src` it was written with - so this is the last place that can tell a
 *  picture from a way up the disk. The names are cleaned where they are made; see
 *  `baseName` in pictures.ts. */
export function insideFolder(path: string): boolean {
  if (/^(?:[A-Za-z]:|[\\/])/.test(path)) return false
  return !path.split(/[\\/]/).includes('..')
}

/** Whether anything is at a path already. Asked of the crate, because the folder
 *  an export is saved into is usually outside every space and nothing else may
 *  look there. */
async function taken(path: string): Promise<boolean> {
  return invoke<boolean>('path_taken', { path })
}

/** The first spelling of `path` under `folder` that neither the disk nor this
 *  export has yet. Compared without case, since two names differing only in case
 *  are one name on Windows and on a Mac. */
async function freeBeside(folder: string, path: string, claimed: Set<string>): Promise<string> {
  for (let counter = 1; ; counter += 1) {
    const candidate = numbered(path, counter)
    const full = joinPath(folder, candidate)
    if (claimed.has(full.toLowerCase()) || (await taken(full))) continue

    claimed.add(full.toLowerCase())
    return candidate
  }
}

/** The first file at the target the dialog was given, and the rest beside it.
 *
 *  The dialog asked about the target and nothing else, so only the target may be
 *  written over. The rest are named after it - pages two and three of `Trip.png`
 *  saved as `Holiday.png` are `Holiday 2.png` and `Holiday 3.png` - and each one
 *  whose name is taken steps aside, by the rule every copy in the app is numbered
 *  by (`numbered` in @nib/markdown/paths). They are written before the first file, so it
 *  can be told where they landed. One after another rather than all at once, since
 *  they share a folder and two writes racing to create it is a race for nothing. */
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

    // Inside the target, which the dialog was asked about whole. One after
    // another, for the reason above.
    for (const file of payload.files) {
      if (insideFolder(file.path)) await writeFile(joinPath(target, file.path), file.body)
    }
    return
  }

  await writeFile(target, 'text' in payload ? payload.text : payload.bytes)
}

/** Shows the finished file where the system shows files. A phone has no file
 *  manager to open, and a browser has its own downloads list. */
async function reveal(target: string): Promise<void> {
  if (!isDesktop) return

  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  await revealItemInDir(target).catch(() => undefined)
}

/** The names already in a folder, for the one build that has to avoid a
 *  collision itself. An unreadable folder reads as an empty one, which is the
 *  answer that lets the first export into a folder that is not there yet. */
async function namesIn(folder: string): Promise<Set<string>> {
  interface Entry {
    name: string
    children: Entry[]
  }

  const tree = await invoke<Entry>('read_tree', { root: folder }).catch(() => null)
  return new Set((tree?.children ?? []).map((child) => child.name))
}

/** Writes into the app's own documents folder, which is the only place a phone
 *  build can put a file the system will still show afterwards. */
async function saveOnPhone(file: string, payload: Payload): Promise<string> {
  const root = await invoke<string>('spaces_root')
  const folder = joinPath(root, EXPORTS)
  const target = joinPath(folder, freeName(file, await namesIn(folder)))

  await writePayload(target, payload)
  return target
}

/** Hands the finished export over, and answers where it went - or null when the
 *  reader closed the dialog.
 *
 *  `label` is what the dialog calls the kind of file, and is already translated
 *  where it needs to be. */
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
