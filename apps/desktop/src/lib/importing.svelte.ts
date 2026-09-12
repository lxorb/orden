/** The one import: what was picked, what it would make, and where it goes.
 *
 *  One sheet for every format, because importing is one thing somebody does once
 *  and there is nothing about it worth asking twice. What was picked says which
 *  app it came from, so there is no format to choose; the counts say how much is
 *  about to arrive, so there is nothing to find out afterwards; and the target is
 *  the same picker moving a note uses, so it is a place the reader already knows
 *  how to choose.
 *
 *  Held here rather than in the sheet because the reading is the slow part: a
 *  zip of six thousand notes takes a moment, and a sheet that is closed and
 *  opened again should not read it twice. */

import { platform } from '@tauri-apps/plugin-os'

import { message, t } from './i18n.svelte'
import { NO_ACCESS, NO_DATABASE } from './import/apple'
import { applyImport } from './import/apply'
import { counts, type Counts, type FormatId, type ImportPlan } from './import/plan'
import { detect, readAs } from './import/read'
import { sourcesFrom, tooMuch, type Picked, type Source } from './import/sources'
import type { Rows } from './import/table'
import { safeName } from './import/names'
import { moveTargets } from './move-targets'
import { invoke, isDesktop } from './tauri'
import { workspace } from './workspace.svelte'

/** What the sheet is doing, which is what it draws. */
export type Stage = 'waiting' | 'reading' | 'ready' | 'writing' | 'done'

/** Names an exporter gives a file that say nothing about what is in it, so the
 *  import's folder is named after the app instead. `AppleJournalEntries` is the
 *  name Journal's own export has, for everybody, every time. */
const MACHINE_MADE =
  /^(applejournalentries|export|takeout|backup|notion|graph|roam|logseq|keep|archive)[\s_-]*/i

class Importing {
  open = $state(false)
  stage = $state<Stage>('waiting')
  format = $state<FormatId | null>(null)
  plan = $state<ImportPlan | null>(null)
  error = $state<string | null>(null)

  /** Where it lands: a space's root, and the folder inside it. */
  root = $state<string | null>(null)
  /** The folder the import makes for itself, inside the target. Empty puts the
   *  files straight into it. */
  folder = $state('')
  /** Which folder of the space the import's own folder goes in. */
  under = $state('')

  /** What a bare table becomes; the one question a format asks. */
  rows = $state<Rows>('table')

  /** How many files have been written, for the progress line. */
  written = $state(0)

  /** How many names were taken, once it has been written. */
  stepped = $state(0)

  /** Set when macOS refuses the folder Notes keeps its notes in, which is what it
   *  does until the app has Full Disk Access. */
  noAccess = $state(false)

  /** The files behind the plan. Not state: they hold the whole export, and
   *  nothing draws them. */
  private sources: Source[] = []

  readonly counts = $derived<Counts>(
    this.plan ? counts(this.plan) : { notes: 0, files: 0, folders: 0, bytes: 0 },
  )

  /** The space it would land in, by name, for the target row. */
  readonly spaceName = $derived(
    workspace.spaces.find((space) => space.root === this.root)?.name ?? '',
  )

  show() {
    this.open = true
    if (this.stage === 'waiting') this.root = workspace.activeSpace?.root ?? null
  }

  close() {
    this.open = false
    // A finished import has nothing left to say, so the next one starts clean.
    if (this.stage === 'done' || this.stage === 'reading') this.forget()
  }

  forget() {
    this.stage = 'waiting'
    this.noAccess = false
    this.sources = []
    this.plan = null
    this.format = null
    this.error = null
    this.written = 0
    this.stepped = 0
    this.folder = ''
    this.rows = 'table'
  }

  /** What the reader picked, read as far as knowing what it would make. */
  async take(picked: readonly Picked[]) {
    if (!picked.length) return

    this.stage = 'reading'
    this.error = null
    this.root ??= workspace.activeSpace?.root ?? null

    try {
      this.sources = await sourcesFrom(picked)
      this.format = await detect(this.sources)

      if (!this.format) {
        this.stage = 'waiting'
        this.error = t('Nothing in there can be read as notes.')
        return
      }

      this.folder = folderNameFor(picked, this.format)
      await this.reread()
    } catch (error) {
      this.stage = 'waiting'
      this.error = message(error, t('That export could not be read.'))
    }
  }

  /** Apple Notes on this Mac, read out of the database Notes keeps.
   *
   *  The one import with no file in it, because Notes has no export: what a reader
   *  would otherwise be told is to install something else first. Only in the
   *  desktop app on a Mac, which is where that database is. */
  async readMac() {
    this.stage = 'reading'
    this.error = null
    this.noAccess = false
    this.sources = []

    try {
      const { readMacNotes } = await import('./import/apple')
      const plan = await readMacNotes()

      this.format = plan.format
      this.folder = nameOfFormat(plan.format)
      this.plan = plan
      this.stage = 'ready'
    } catch (error) {
      this.stage = 'waiting'
      this.error = whyNotRead(error)
      this.noAccess = message(error, '') === NO_ACCESS
    }
  }

  /** Opens Full Disk Access in System Settings, since a sheet that names a
   *  permission and leaves the reader to find the pane has asked twice. */
  async openAccess() {
    await invoke('open_full_disk_access').catch(() => undefined)
  }

  /** The plan again, for a choice that changes what would be made. */
  async reread() {
    if (!this.format) return

    this.stage = 'reading'
    const plan = await readAs(this.format, this.sources, { rows: this.rows })
    this.plan = plan
    this.stage = 'ready'

    if (tooMuch(counts(plan).bytes)) {
      this.error = t('That export is too big to read in one go.')
    }
  }

  /** Whether what was picked is one of the kinds pandoc reads and nothing here
   *  does: a Word file, an ODT, an ePub, a LaTeX paper. */
  readonly needsPandoc = $derived(this.format === 'pandoc')

  /** Hands the document to pandoc, which reads it off the disk itself.
   *
   *  Which is why it asks for the file again: pandoc is a program on the machine
   *  rather than a reader in here, and a program takes a path where the drop zone
   *  took bytes. One press, and the sheet says why before it.  */
  async readWithPandoc() {
    const { importDocument } = await import('./export')
    const imported = await importDocument()
    if (!imported) return

    workspace.openBlank(imported.name, imported.markdown)
    this.open = false
    this.forget()
  }

  setRows(rows: Rows) {
    if (this.rows === rows) return
    this.rows = rows
    void this.reread()
  }

  /** Where it goes, through the picker that moving a note already uses. */
  async chooseTarget() {
    // Nothing is moving, so every note of the space and every other space is
    // offered: the same list, asked with nothing in hand.
    const targets = moveTargets({
      moving: '',
      tree: workspace.tree,
      spaces: workspace.spaces,
      here: workspace.activeSpace?.root ?? null,
    })

    const { prompt } = await import('./prompt.svelte')
    const into = await prompt.find({ title: t('Import into'), options: [...targets] })
    if (!into) return

    const space = workspace.spaces.find(
      (one) => into === one.root || into.startsWith(`${one.root}/`),
    )
    this.root = space?.root ?? this.root
    this.under = space && into !== space.root ? relativeFolder(space.root, into) : ''
  }

  /** Writes it. */
  async run() {
    const plan = this.plan
    const root = this.root
    if (!plan || !root || this.stage === 'writing') return

    this.stage = 'writing'
    this.written = 0
    this.error = null

    try {
      const landed = await applyImport(
        plan,
        { root, folder: [this.under, safeName(this.folder)].filter(Boolean).join('/') },
        { onWritten: (done) => (this.written = done) },
      )

      this.stepped = landed.stepped
      this.stage = 'done'
    } catch (error) {
      this.stage = 'ready'
      this.error = message(error, t('That import could not be written.'))
    }
  }
}

/** Whether this machine is the one platform that can be read without an export:
 *  a Mac, in the desktop app. `platform()` reads what the os plugin left in the
 *  page before the first script ran, so this is known without waiting. */
export function onMac(): boolean {
  return isDesktop && platform() === 'macos'
}

/** Why a read of the Mac's own notes did not happen, in words. The crate answers
 *  two of these as marks rather than sentences, because what to say about a
 *  permission is the sheet's business and not the crate's. */
function whyNotRead(error: unknown): string {
  const said = message(error, '')

  if (said === NO_ACCESS) {
    return t('macOS keeps those notes behind Full Disk Access.')
  }

  if (said === NO_DATABASE) {
    return t('There are no notes in Apple Notes on this Mac.')
  }

  return message(error, t('Those notes could not be read.'))
}

/** What the import's own folder is called: after the file that was picked, since
 *  that is the name the reader recognises, and after the app it came out of when
 *  the file's name is one an exporter made up. */
export function folderNameFor(picked: readonly Picked[], format: FormatId): string {
  const first = picked[0]
  const named = picked.length === 1 && first ? stemOf(first) : ''
  const stripped = named.replace(MACHINE_MADE, '').trim()

  // `Export-9f1c2d3e.zip` leaves `9f1c2d3e`, which is the export's id rather than
  // a name anybody would give a folder, and `backup.zip` leaves nothing at all. A
  // name has a word in it.
  const wordy = /[A-Za-z]{3,}/.test(stripped) && !/^[0-9a-f-]+$/i.test(stripped)

  return wordy ? safeName(stripped) : nameOfFormat(format)
}

/** The folder a name-less export lands in, which is the app it came out of. */
function nameOfFormat(format: FormatId): string {
  switch (format) {
    case 'notion':
      return 'Notion'
    case 'evernote':
      return 'Evernote'
    case 'keep':
      return 'Google Keep'
    case 'bear':
      return 'Bear'
    case 'logseq':
      return 'Logseq'
    case 'roam':
      return 'Roam'
    case 'craft':
      return 'Craft'
    case 'onenote':
      return 'OneNote'
    case 'tomboy':
      return 'Tomboy'
    case 'apple-notes':
      return 'Apple Notes'
    case 'journal':
      return 'Journal'
    case 'table':
    case 'markdown':
    case 'pandoc':
      return 'Imported'
  }
}

function stemOf(picked: Picked): string {
  // A folder that was dropped is named by the folder rather than by whichever
  // file inside it came back first, which is what its first part is.
  const inside = (picked.webkitRelativePath ?? '').trim()
  const path = inside.length ? inside : picked.name
  const first = path.split('/').find(Boolean) ?? ''

  return first.replace(/\.[^.]+$/, '')
}

function relativeFolder(root: string, path: string): string {
  return path
    .slice(root.length)
    .replace(/^[\\/]+/, '')
    .replace(/\\/g, '/')
}

export const importing = new Importing()
