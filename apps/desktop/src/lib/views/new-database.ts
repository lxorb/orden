/** A new database, Notion's: a folder whose own note holds a board over the notes
 *  beside it in that folder (docs/tasks.md 5.9). One row in the file list, since the
 *  tree draws a folder as its note; the base is a ` ```base ` fence in that note, so
 *  the database moves and renames as the note does, and Obsidian reads it the same.
 *
 *  The board opens on a Status of three options in the tones a Notion status has,
 *  medium cards, and the column of no status first, where a page nobody gave one
 *  lands. */

import { type Base, writeBase } from '@nib/bases'
import { folderNotePath } from '../folder-notes'
import { t } from '../i18n.svelte'
import { samePath } from '../space-paths'
import { joinPath } from '../tauri'
import { writeFile } from '../workspace/write-file'
import { workspace } from '../workspace.svelte'

/** The base a new database starts as. `status` is the property's key in the notes'
 *  front matter, `shown` what the board calls it. */
function databaseBase(status: string, view: string, shown: string): Base {
  return {
    // The notes in the folder the fence's note is in, and not that note itself.
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
        nib: { kept: {}, noneFirst: true, cardSize: 'medium' },
        options: {},
      },
    ],
    nib: {
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

/** The words of a new database's note. */
export function databaseNote(): string {
  const base = databaseBase('status', t('Board'), t('Status'))
  return `\`\`\`base\n${writeBase(base).trimEnd()}\n\`\`\`\n`
}

/** Makes a database in a folder and opens it: a folder of its own, named as the row
 *  waiting for a name is, whose note holds the board. Where there is a list to type
 *  in, the row asks for the name first, as a note's does. */
export async function createDatabase(folder?: string, named?: string): Promise<void> {
  const dir = folder ?? workspace.activeSpace?.root
  if (!dir) return
  if (named === undefined && workspace.startNaming('database', dir)) return

  const wanted = (named ?? t('Board')).trim().replace(/[\\/:*?"<>|]/g, '-') || t('Board')
  const path = folderNotePath(joinPath(dir, workspace.freeName(dir, wanted)))
  await writeFile(path, databaseNote())
  workspace.undone.record({ kind: 'create', path })
  await workspace.loadTree()
  if (!samePath(dir, workspace.activeSpace?.root)) workspace.device.expand(dir)
  await workspace.open(path)
  workspace.persist()
}
