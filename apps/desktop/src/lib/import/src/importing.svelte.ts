import { askSheet, type PandocPicture, type PickedFile } from '@orden/contracts'
import { relativeTo, rootedAt, invoke, joinPath } from '../../platform/src/api'
import { canWriteAt } from '../../sharing/src/api'
import { busy, message, prompt } from '../../ui-kit/src/api'
import { moveTargets } from '../../tree/src/api'
import { workspace } from '../../workspace/src/api'
import { macNotes, todoistAccount } from './api'
import { importDocument } from './document'
import { folderNameFor, nameOfFormat } from './folder-name'
import { keepPictures } from './pandoc-pictures'
import { counts, type Counts, type FormatId, type ImportPlan } from './plan'
import { detect, readAs } from './read'
import { insideFolder, sourcesFrom, tooMuch, type Source } from './sources'
import { safeName } from './names'
import type { Rows } from './table'

export type Stage = 'waiting' | 'reading' | 'ready'
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
  noAccess = $state(false)
  private sources: Source[] = []
  readonly counts = $derived<Counts>(this.plan ? counts(this.plan) : { notes: 0, files: 0, folders: 0, bytes: 0 })
  readonly spaceName = $derived(rootedAt(workspace.spaces, this.root)?.name ?? '')
  show() {
    void askSheet('import')
    this.open = true
    if (this.stage === 'waiting') this.root = landing()
  }
  close() {
    this.open = false
    if (this.stage === 'reading') this.forget()
  }
  forget() {
    this.stage = 'waiting'
    this.noAccess = false
    this.sources = []
    this.plan = null
    this.format = null
    this.error = null
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
      root === null ? imported.markdown : await this.withPictures(imported, joinPath(root, imported.name))
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
    const { storeBeside } = await import('../../workspace/src/api')
    const { markdown, lost } = await keepPictures(imported.markdown, imported.pictures, (bytes, name) =>
      storeBeside(bytes.slice().buffer, notePath, name),
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
    const space = workspace.spaces.find((one) => into === one.root || into.startsWith(`${one.root}/`))
    this.root = space?.root ?? this.root
    this.under = space && into !== space.root ? relativeTo(space.root, into) : ''
  }
  async run() {
    const plan = this.plan
    const root = this.root
    if (!plan || !root) return
    const folder = [this.under, this.folder.trim() && safeName(this.folder)].filter(Boolean).join('/')
    if (!canWriteAt(folder ? joinPath(root, folder) : root)) {
      this.error = 'That import could not be written.'
      return
    }
    const app = plan.format === 'todoist' ? 'Todoist' : nameOfFormat(plan.format)
    const own = app !== 'Imported'
    const label = plan.format === 'todoist' ? 'my Todoist account' : own ? `my ${app} export` : 'the files I picked'
    this.open = false
    this.forget()
    const { startImport } = await import('./run.svelte')
    await startImport({
      name: app,
      label,
      title: own ? app : 'Files',
      into: { root, folder, kept: this.under },
      read: () => Promise.resolve({ plan }),
    })
  }
}
function landing(): string | null {
  const open = workspace.activeSpace?.root ?? null
  if (open !== null && canWriteAt(open)) return open
  return workspace.spaces.find((space) => canWriteAt(space.root))?.root ?? null
}
export const importing = new Importing()
