import type { Folder, Vault } from '@orden/pass/types'
import { iconChoice } from '../icon-choice.svelte'
import { t } from '../i18n.svelte'
import { DIVIDER, type MenuEntry } from '../menu.svelte'
import { prompt } from '../prompt.svelte'
import { newId } from './rows'
import { pass } from './store.svelte'
import type { PassUi } from './ui.svelte'

async function newFolder(vault: Vault, parent: string | null): Promise<void> {
  const name = await prompt.ask({ title: t('New folder'), confirmLabel: t('Create') })
  if (!name) return
  const folder: Folder = { id: newId(), name, parent }
  await pass.updateVault(vault.id, { folders: [...vault.folders, folder] })
}

async function moveAll(ui: PassUi, vault: Vault): Promise<void> {
  const others = pass.vaults.filter((one) => one.id !== vault.id)
  const to = await prompt.choose({
    title: t('Move all items to'),
    options: others.map((one) => ({ id: one.id, label: one.name })),
  })
  if (!to) return
  await pass.moveAll(vault.id, to)
  await ui.choose({ kind: 'vault', vault: to, folder: null })
}

async function deleteVault(ui: PassUi, vault: Vault): Promise<void> {
  const sure = await prompt.confirm({
    title: t('Delete {vault}?', { vault: vault.name }),
    detail: t('Every item in it is deleted for good.'),
    confirmLabel: t('Delete'),
    danger: true,
  })
  if (!sure) return
  await pass.deleteVault(vault.id)
  await ui.choose({ kind: 'all' })
}

export function vaultEntries(ui: PassUi, vault: Vault): MenuEntry[] {
  const share = () => (ui.sheet = { kind: 'share', vault: vault.id })
  return [
    { label: t('Edit vault'), run: () => (ui.sheet = { kind: 'vault', vault: vault.id }) },
    { label: t('Share'), run: share },
    { label: t('Manage access'), run: share },
    { label: t('New folder'), run: () => void newFolder(vault, null) },
    {
      label: t('Move all items'),
      disabled: pass.vaults.length < 2,
      run: () => void moveAll(ui, vault),
    },
    DIVIDER,
    {
      label: t('Delete vault'),
      danger: true,
      disabled: pass.vaults.length < 2,
      run: () => void deleteVault(ui, vault),
    },
  ]
}

function inside(folders: readonly Folder[], root: string): Set<string> {
  const found = new Set([root])
  let grew = true
  while (grew) {
    grew = false
    for (const one of folders) {
      if (one.parent !== null && found.has(one.parent) && !found.has(one.id)) {
        found.add(one.id)
        grew = true
      }
    }
  }
  return found
}

async function renameFolder(vault: Vault, folder: Folder): Promise<void> {
  const name = await prompt.ask({
    title: t('Rename folder'),
    value: folder.name,
    confirmLabel: t('Rename'),
  })
  if (!name || name === folder.name) return
  await pass.updateVault(vault.id, {
    folders: vault.folders.map((one) => (one.id === folder.id ? { ...one, name } : one)),
  })
}

async function deleteFolder(ui: PassUi, vault: Vault, folder: Folder): Promise<void> {
  const sure = await prompt.confirm({
    title: t('Delete {folder}?', { folder: folder.name }),
    detail: t('Its items stay in the vault.'),
    confirmLabel: t('Delete'),
    danger: true,
  })
  if (!sure) return
  const gone = inside(vault.folders, folder.id)
  const items = pass.items
    .filter((one) => one.vault === vault.id && one.folder !== null && gone.has(one.folder))
    .map((one) => one.id)
  await pass.move(items, vault.id, null)
  await pass.updateVault(vault.id, { folders: vault.folders.filter((one) => !gone.has(one.id)) })
  await ui.choose({ kind: 'vault', vault: vault.id, folder: null })
}

function chooseFolderIcon(vault: Vault, folder: Folder): void {
  iconChoice.pass(folder.mark ?? null, (mark) => {
    const now = pass.vaults.find((one) => one.id === vault.id)
    if (!now?.folders.some((one) => one.id === folder.id)) return
    const folders = now.folders.map((one) =>
      one.id === folder.id ? { ...one, mark: mark ?? undefined } : one,
    )
    void pass.updateVault(vault.id, { folders })
  })
}

export function folderEntries(ui: PassUi, vault: Vault, folder: Folder): MenuEntry[] {
  return [
    { label: t('Rename'), run: () => void renameFolder(vault, folder) },
    { label: t('Choose an icon'), run: () => chooseFolderIcon(vault, folder) },
    { label: t('New folder'), run: () => void newFolder(vault, folder.id) },
    DIVIDER,
    { label: t('Delete folder'), danger: true, run: () => void deleteFolder(ui, vault, folder) },
  ]
}
