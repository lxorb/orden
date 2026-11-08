import { fillTemplate, withoutTemplateKeys } from '@orden/bases'
import { t } from '../i18n.svelte'
import { menu } from '../menu.svelte'
import { rows } from '../rows/rows.svelte'
import { folderOf, insideSpace, relativeTo, samePath, within } from '../space-paths'
import { invoke, joinPath } from '../tauri'
import { type Entry, workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import { nowHere } from './days'

const folders = new Map<string, Promise<string>>()

export function templatesFolder(root: string): Promise<string> {
  let found = folders.get(root)
  if (!found) {
    found = invoke<string>('read_note', { path: joinPath(root, '.obsidian/templates.json') })
      .then((text) => {
        const said: unknown = JSON.parse(text)
        const folder =
          said !== null && typeof said === 'object' && 'folder' in said ? said.folder : null
        return typeof folder === 'string' && folder.trim()
          ? folder.trim().replace(/^\/+|\/+$/g, '')
          : 'Templates'
      })
      .catch(() => 'Templates')
    folders.set(root, found)
  }
  return found
}

export async function templates(): Promise<Entry[]> {
  const root = workspace.activeSpace?.root
  if (root === undefined) return []
  const folder = joinPath(root, await templatesFolder(root))
  return workspace.notes
    .filter(
      (one) =>
        /\.md$/i.test(one.name) &&
        within(folder, one.path, root) !== null &&
        !workspace.protection.locked(one.path),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function templatePath(link: string, space = workspace.activeSpace): string | null {
  if (!space) return null
  const root = space.root
  const wanted = link
    .replace(/^\[\[|\]\]$/g, '')
    .split('|')[0]
    ?.trim()
    .replace(/\.md$/i, '')
    .toLowerCase()
  if (!wanted) return null
  const notes = samePath(root, workspace.activeSpace?.root)
    ? workspace.notes.map((one) => ({ relative: relativeTo(root, one.path), name: one.name }))
    : rows
        .of(space.name)
        .filter((row) => row.kind === 'note')
        .map((row) => ({ relative: row.path, name: `${row.file.basename}.md` }))
  const byPath = notes.find((one) => one.relative.replace(/\.md$/i, '').toLowerCase() === wanted)
  const byName = notes.find((one) => one.name.replace(/\.md$/i, '').toLowerCase() === wanted)
  const found = byPath ?? byName
  return found ? insideSpace(root, found.relative) : null
}

export async function templateWords(path: string, title: string): Promise<string> {
  if (workspace.protection.locked(path)) return ''
  const text = await workspace.noteText(path).catch(() => null)
  if (text === null) return ''
  const now = nowHere()
  return withoutTemplateKeys(
    fillTemplate(text, { title, today: now.slice(0, 10), time: now.slice(11, 16) }),
  )
}

export async function pickTemplate(): Promise<void> {
  const space = workspace.activeSpace
  if (!space) return
  const found = await templates()
  if (!found.length) return
  const active = workspace.active?.path ?? null
  const dir =
    active && within(space.root, active, space.root) !== null ? folderOf(active) : space.root
  const make = async (template: string) => {
    const name = await workspace.freeNameOnDisk(dir, 'Untitled.md')
    const path = joinPath(dir, name)
    await writeFile(path, await templateWords(template, name.replace(/\.md$/i, '')))
    await workspace.loadTree()
    await workspace.fileCame(path, 'file')
    await workspace.open(path)
  }
  const at = new MouseEvent('contextmenu', {
    clientX: window.innerWidth / 2,
    clientY: window.innerHeight / 3,
  })
  menu.show(
    at,
    found.map((one) => ({ label: one.name.replace(/\.md$/i, ''), run: () => void make(one.path) })),
    { title: t('New note from template') },
  )
}
