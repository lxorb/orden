import { type Base, writeBase } from '@orden/bases'
import { folderNotePath } from '../folder-notes'
import { t } from '../i18n.svelte'
import { basesOn } from '../settings.svelte'
import { samePath } from '../space-paths'
import { joinPath } from '../tauri'
import { writeFile } from '../workspace/write-file'
import { workspace } from '../workspace.svelte'

function databaseBase(status: string, view: string, shown: string): Base {
  return {
    filters: { and: ['file.folder == this.file.folder', 'file.path != this.file.path'] },
    formulas: {},
    properties:
      shown.toLowerCase() === status
        ? {}
        : { [`note.${status}`]: { displayName: shown, kept: {} } },
    summaries: {},
    views: [
      {
        type: 'kanban',
        name: view,
        order: [`note.${status}`],
        sort: [],
        summaries: {},
        groupBy: { property: `note.${status}`, direction: 'ASC' },
        orden: { kept: {}, noneFirst: true, cardSize: 'medium' },
        options: {},
      },
    ],
    orden: {
      properties: {
        [status]: {
          options: [
            { value: t('Not started'), group: 'todo' },
            { value: t('In progress'), group: 'doing', tone: '5' },
            { value: t('Done'), group: 'done', tone: '4' },
          ],
          kept: {},
        },
      },
      kept: {},
    },
    kept: {},
  }
}

export function databaseNote(): string {
  const base = databaseBase('status', t('Board'), t('Status'))
  return `\`\`\`base\n${writeBase(base).trimEnd()}\n\`\`\`\n`
}

async function freeFolder(dir: string, wanted: string): Promise<string> {
  let name = wanted
  for (;;) {
    const folder = await workspace.freeNameOnDisk(dir, name)
    const note = await workspace.freeNameOnDisk(dir, `${folder}.md`)
    if (note === `${folder}.md`) return folder
    name = note.slice(0, -'.md'.length)
  }
}

export function databaseName(named: string | undefined): string {
  const typed = (named ?? t('Board')).trim().replace(/\.md$/i, '')
  const wanted = typed.replace(/[\\/:*?"<>|]/g, '-').trim()
  return /^\.*$/.test(wanted) ? t('Board') : wanted
}

export async function createDatabase(folder?: string, named?: string): Promise<void> {
  const dir = folder ?? workspace.activeSpace?.root
  if (!dir || !basesOn()) return
  if (named === undefined && workspace.startNaming('database', dir)) return

  const path = folderNotePath(joinPath(dir, await freeFolder(dir, databaseName(named))))
  await writeFile(path, databaseNote())
  workspace.undone.record({ kind: 'create', path })
  await workspace.loadTree()
  if (!samePath(dir, workspace.activeSpace?.root)) workspace.device.expand(dir)
  await workspace.open(path)
  workspace.persist()
}
