import type { PandocPicture, PickedFile } from '@orden/contracts'
import { relativeTo, rootedAt, invoke, joinPath } from '../../platform/src/api'
import { canWriteAt } from '../../sharing/src/api'
import { busy, message, prompt } from '../../ui-kit/src/api'
import { moveTargets } from '../../move-targets'
import { importSheet } from '../../surfaces.svelte'
import { workspace } from '../../workspace.svelte'
import { macNotes, todoistAccount } from './api'
import { applyImport } from './apply'
import { importDocument } from './document'
import { folderNameFor, nameOfFormat } from './folder-name'
import { keepPictures } from './pandoc-pictures'
import { counts, type Counts, type FormatId, type ImportPlan } from './plan'
import { detect, readAs } from './read'
import { insideFolder, sourcesFrom, tooMuch, type Source } from './sources'
import { safeName } from './names'
import type { Rows } from './table'

export type Stage = 'waiting' | 'reading' | 'ready' | 'writing' | 'done'

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

  readonly spaceName = $derived(rootedAt(workspace.spaces, this.root)?.name ?? '')

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

  async take(picked: readonly PickedFile[]) {
    if (!picked.length) return

    this.stage = 'reading'
    this.error = null
    this.root ??= landing()

    try {
      this.sources = await sourcesFrom(insideFolder(picked))
      this.format = await detect(this.sources)

      if (!this.format) {
        this.stage = 'waiting'
        this.error = 'Nothing in there can be read as notes.'
        return
      }

      this.folder = folderNameFor(picked, this.format)
      await this.reread()
    } catch (error) {
      this.stage = 'waiting'
      this.error = message(error, 'That export could not be read.')
    }
  }

  async readMac() {
    this.stage = 'reading'
    this.error = null
    this.noAccess = false
    this.sources = []

    const apple = await macNotes()

    try {
      const plan = await apple.readMacNotes()

      this.format = plan.format
      this.folder = nameOfFormat(plan.format)
      this.plan = plan
      this.stage = 'ready'
    } catch (error) {
      const fault = apple.notesFault(error)
      this.stage = 'waiting'
      this.noAccess = fault.noAccess
      this.error = fault.said
    }
  }

  async readTodoist(token: string, completed: boolean) {
    const said = token.trim()
    if (!said) return
    this.stage = 'reading'
    this.error = null
    this.sources = []

    try {
      const todoist = await todoistAccount()
      const account = await todoist.readTodoistAccount(fetch, said, { completed })
      const plan = todoist.planOf(account)
      this.format = plan.format
      this.folder = nameOfFormat(plan.format)
      this.plan = plan
      this.stage = 'ready'
    } catch (error) {
      this.stage = 'waiting'
      this.error = message(error, 'Todoist could not be reached.')
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
      this.error = 'That export is too big to read in one go.'
    }
  }

  readonly needsPandoc = $derived(this.format === 'pandoc')

  async readWithPandoc() {
    const imported = await importDocument()
    if (!imported) return

    const root = await this.pandocRoot()
    const home = rootedAt(workspace.spaces, root)?.id ?? null
    if (root === null && imported.pictures.length) busy.failed('That picture could not be read.')
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
    const known = rootedAt(workspace.spaces, asked) !== undefined
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
    const { storeBeside } = await import('../../assets')
    const { markdown, lost } = await keepPictures(
      imported.markdown,
      imported.pictures,
      (bytes, name) => storeBeside(bytes.slice().buffer, notePath, name),
    )
    void workspace.loadTree()
    if (lost) busy.failed('That picture could not be read.')
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

    const into = await prompt.find({ title: 'Import into', options: [...targets] })
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
      this.stage = 'done'
    } catch (error) {
      this.stage = 'ready'
      this.error = message(error, 'That import could not be written.')
    }
  }
}

function landing(): string | null {
  const open = workspace.activeSpace?.root ?? null
  if (open !== null && canWriteAt(open)) return open
  return workspace.spaces.find((space) => canWriteAt(space.root))?.root ?? null
}

export const importing = new Importing()
