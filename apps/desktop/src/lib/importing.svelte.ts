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

import { message, t } from './i18n.svelte'
import { applyImport } from './import/apply'
import { counts, type Counts, type FormatId, type ImportPlan } from './import/plan'
import { detect, readAs } from './import/read'
import { sourcesFrom, tooMuch, type Picked, type Source } from './import/sources'
import type { Rows } from './import/table'
import { safeName } from './import/names'
import { moveTargets } from './move-targets'
import { workspace } from './workspace.svelte'

/** What the sheet is doing, which is what it draws. */
export type Stage = 'waiting' | 'reading' | 'ready' | 'writing' | 'done'

/** Names an exporter gives a file that say nothing about what is in it, so the
 *  import's folder is named after the app instead. */
const MACHINE_MADE = /^(export|takeout|backup|notion|graph|roam|logseq|keep|archive)[\s_-]*/i

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
    const spaces = workspace.spaces.map((space) => ({ name: space.name, root: space.root }))
    // Nothing is moving, so every folder of the space and every other space is
    // offered: the same list, asked with nothing in hand.
    const targets = moveTargets({
      moving: '',
      tree: workspace.tree,
      spaces,
      here: workspace.activeSpace?.root ?? null,
    })

    const { prompt } = await import('./prompt.svelte')
    const into = await prompt.find({
      title: t('Import into'),
      options: targets.map((one) => ({ id: one.id, label: one.label, mark: one.mark })),
      placeholder: t('Folder'),
    })

    if (!into) return

    const space = spaces.find((one) => into === one.root || into.startsWith(`${one.root}/`))
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
