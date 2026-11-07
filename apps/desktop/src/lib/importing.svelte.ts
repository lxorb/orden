import { busy } from './busy.svelte'
import { message, t } from './i18n.svelte'
import { applyImport } from './import/apply'
import { keepPictures, type PandocPicture } from './import/pandoc-pictures'
import { counts, type Counts, type FormatId, type ImportPlan } from './import/plan'
import { detect, readAs } from './import/read'
import {
  insideFolder,
  pickedFolder,
  sourcesFrom,
  tooMuch,
  type Picked,
  type Source,
} from './import/sources'
import type { Rows } from './import/table'
import { safeName } from './import/names'
import { moveTargets } from './move-targets'
import { canWriteAt } from './sharing.svelte'
import { relativeTo } from './space-paths'
import { importSheet } from './surfaces.svelte'
import { invoke, isDesktop, joinPath, platform } from './tauri'
import { workspace } from './workspace.svelte'

export type Stage = 'waiting' | 'reading' | 'ready' | 'writing' | 'done'

const MACHINE_MADE =
  /^(applejournalentries|export|takeout|backup|notion|graph|roam|logseq|keep|archive)(?:[\s_-]+|$)/i

class Importing {
  open = $state(false)
  stage = $state<Stage>('waiting')
  format = $state<FormatId | null>(null)
  plan = $state<ImportPlan | null>(null)
  error = $state<string | null>(null)

  root = $state<string | null>(null)
  folder = $state('')
  under = $state('')

  rows = $state<Rows>('table')

  written = $state(0)

  stepped = $state(0)

  noAccess = $state(false)

  private sources: Source[] = []

  readonly counts = $derived<Counts>(
    this.plan ? counts(this.plan) : { notes: 0, files: 0, folders: 0, bytes: 0 },
  )

  readonly spaceName = $derived(
    workspace.spaces.find((space) => space.root === this.root)?.name ?? '',
  )

  show() {
    void importSheet.ask()
    this.open = true
    if (this.stage === 'waiting') this.root = landing()
  }

  close() {
    this.open = false
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

  async take(picked: readonly Picked[]) {
    if (!picked.length) return

    this.stage = 'reading'
    this.error = null
    this.root ??= landing()

    try {
      this.sources = await sourcesFrom(insideFolder(picked))
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

  async readMac() {
    this.stage = 'reading'
    this.error = null
    this.noAccess = false
    this.sources = []

    const apple = await import('./import/apple')

    try {
      const plan = await apple.readMacNotes()

      this.format = plan.format
      this.folder = nameOfFormat(plan.format)
      this.plan = plan
      this.stage = 'ready'
    } catch (error) {
      const answered = saidBy(error)

      this.stage = 'waiting'
      this.noAccess = answered === apple.NO_ACCESS

      if (this.noAccess) {
        this.error = t('macOS keeps those notes behind Full Disk Access.')
      } else if (answered === apple.NO_DATABASE) {
        this.error = t('There are no notes in Apple Notes on this Mac.')
      } else {
        this.error = message(error, t('Those notes could not be read.'))
      }
    }
  }

  async readTodoist(token: string, completed: boolean) {
    const said = token.trim()
    if (!said) return
    this.stage = 'reading'
    this.error = null
    this.sources = []

    try {
      const todoist = await import('./import/todoist')
      const account = await todoist.readTodoistAccount(fetch, said, { completed })
      const plan = todoist.planOf(account)
      this.format = plan.format
      this.folder = nameOfFormat(plan.format)
      this.plan = plan
      this.stage = 'ready'
    } catch (error) {
      this.stage = 'waiting'
      this.error = message(error, t('Todoist could not be reached.'))
    }
  }

  async openAccess() {
    await invoke('open_full_disk_access').catch(() => undefined)
  }

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

  readonly needsPandoc = $derived(this.format === 'pandoc')

  async readWithPandoc() {
    const { importDocument } = await import('./export')
    const imported = await importDocument()
    if (!imported) return

    const root = await this.pandocRoot()
    const home = workspace.spaces.find((one) => one.root === root)?.id ?? null
    if (root === null && imported.pictures.length) busy.failed(t('That picture could not be read.'))
    const markdown =
      root === null
        ? imported.markdown
        : await this.withPictures(imported, joinPath(root, imported.name))
    workspace.openBlank(imported.name, markdown, home)
    this.open = false
    this.forget()
  }

  private async pandocRoot(): Promise<string | null> {
    const asked = this.root
    const known = workspace.spaces.some((one) => one.root === asked)
    if (asked !== null && known && canWriteAt(asked)) return asked

    const found = landing()
    if (found !== null || workspace.spaces.length) return found

    const made = await workspace.draftHome(null).catch(() => null)
    return made !== null && canWriteAt(made) ? made : null
  }

  private async withPictures(
    imported: { markdown: string; pictures: PandocPicture[] },
    notePath: string,
  ): Promise<string> {
    if (!imported.pictures.length) return imported.markdown
    const { storeBeside } = await import('./assets')
    const { markdown, lost } = await keepPictures(
      imported.markdown,
      imported.pictures,
      (bytes, name) => storeBeside(bytes.slice().buffer, notePath, name),
    )
    void workspace.loadTree()
    if (lost) busy.failed(t('That picture could not be read.'))
    return markdown
  }

  setRows(rows: Rows) {
    if (this.rows === rows) return
    this.rows = rows
    void this.reread()
  }

  async chooseTarget() {
    const targets = moveTargets({
      moving: '',
      tree: workspace.tree,
      spaces: workspace.spaces,
      here: workspace.activeSpace?.root ?? null,
    }).filter((target) => canWriteAt(target.id))

    const { prompt } = await import('./prompt.svelte')
    const into = await prompt.find({ title: t('Import into'), options: [...targets] })
    if (!into) return

    const space = workspace.spaces.find(
      (one) => into === one.root || into.startsWith(`${one.root}/`),
    )
    this.root = space?.root ?? this.root
    this.under = space && into !== space.root ? relativeTo(space.root, into) : ''
  }

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
      await inboxFrom(plan, root, landed.paths)
      if (plan.format === 'todoist') await listsFrom(landed.paths)
      this.stage = 'done'
    } catch (error) {
      this.stage = 'ready'
      this.error = message(error, t('That import could not be written.'))
    }
  }
}

function landing(): string | null {
  const open = workspace.activeSpace?.root ?? null
  if (open !== null && canWriteAt(open)) return open
  return workspace.spaces.find((space) => canWriteAt(space.root))?.root ?? null
}

async function listsFrom(paths: readonly string[]) {
  const { makeList } = await import('./rows/todo-lists')
  for (const path of paths) if (/\.md$/i.test(path)) makeList(path)
}

async function inboxFrom(plan: ImportPlan, root: string, paths: readonly string[]) {
  const at = plan.inbox === undefined ? -1 : plan.files.findIndex((one) => one.path === plan.inbox)
  const path = paths[at]
  if (path === undefined) return
  const { carryInto } = await import('./rows/inbox-moving.svelte')
  await carryInto(root, path)
}

export function onMac(): boolean {
  return isDesktop && platform() === 'macos'
}

function saidBy(error: unknown): string {
  if (typeof error === 'string') return error
  return error instanceof Error ? error.message : ''
}

export function folderNameFor(picked: readonly Picked[], format: FormatId): string {
  if (format === 'todoist') return ''
  const first = picked[0]
  const named = pickedFolder(picked) ?? (picked.length === 1 && first ? stemOf(first) : '')
  const stripped = (format === 'obsidian' ? named : named.replace(MACHINE_MADE, '')).trim()

  const wordy = /\p{L}{2,}/u.test(stripped) && !/^[0-9a-f-]+$/i.test(stripped)

  return wordy ? safeName(stripped) : nameOfFormat(format)
}

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
    case 'obsidian':
      return 'Obsidian'
    case 'onenote':
      return 'OneNote'
    case 'tomboy':
      return 'Tomboy'
    case 'apple-notes':
      return 'Apple Notes'
    case 'journal':
      return 'Journal'
    case 'pdf-pages':
      return 'Papers'
    case 'todoist':
      return ''
    case 'table':
    case 'markdown':
    case 'pandoc':
      return 'Imported'
  }
}

function stemOf(picked: Picked): string {
  return picked.name.replace(/\.[^.]+$/, '')
}

export const importing = new Importing()
