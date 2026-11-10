import type { BrowserId } from '../import/browsers'
import { busy } from '../busy.svelte'
import { message, t } from '../i18n.svelte'
import type { FormatId } from '../import/plan'
import type { Picked, Source } from '../import/sources'
import { isDesktop } from '../tauri'
import type { Bringing } from './catalog'

export interface Outcome {
  picked: boolean
  trouble: string | null
}

interface Read {
  name: string | ((format: FormatId) => Promise<string>)
  sources: Source[]
}

async function running(task: () => Promise<boolean>): Promise<Outcome> {
  let picked = false
  let trouble: string | null = null
  await busy.run(t('Importing'), async () => {
    try {
      picked = await task()
    } catch (error) {
      picked = true
      trouble = message(error, t('That import could not be written.'))
    }
    trouble ??= busy.trouble
  })
  return { picked, trouble }
}

async function landed(read: Read | null): Promise<boolean> {
  if (!read) return false
  const { arrive, importAsSpace } = await import('../migrating.svelte')
  await arrive(await importAsSpace(read.name, read.sources))
  return true
}

async function folder(): Promise<Read | null> {
  const [{ pickFolder }, { insideFolder, pickedFolder, sourcesFrom }] = await Promise.all([
    import('../import/picking'),
    import('../import/sources'),
  ])
  const picked = await pickFolder()
  const name = pickedFolder(picked)
  if (!name) return null
  return { name, sources: await sourcesFrom(insideFolder(picked)) }
}

async function files(): Promise<Read | null> {
  const [{ pickFiles }, { sourcesFrom }, { folderNameFor }] = await Promise.all([
    import('../import/picking'),
    import('../import/sources'),
    import('../importing.svelte'),
  ])
  const picked: Picked[] = await pickFiles()
  if (!picked.length) return null
  return {
    name: (format) => Promise.resolve(folderNameFor(picked, format)),
    sources: await sourcesFrom(picked),
  }
}

async function vault(): Promise<Read | null> {
  const { vaults, vaultSources } = await import('../import/vaults')
  const found = isDesktop ? await vaults() : []
  const [only] = found
  if (found.length !== 1 || !only) return folder()
  return { name: only.name, sources: await vaultSources(only) }
}

async function macNotes(): Promise<boolean> {
  const [apple, { applyImport }, { arrive }, { workspace }] = await Promise.all([
    import('../import/apple'),
    import('../import/apply'),
    import('../migrating.svelte'),
    import('../workspace.svelte'),
  ])
  const plan = await apple.readMacNotes().catch((error: unknown) => {
    const said = typeof error === 'string' ? error : error instanceof Error ? error.message : ''
    if (said === apple.NO_ACCESS)
      throw new Error(t('macOS keeps those notes behind Full Disk Access.'))
    if (said === apple.NO_DATABASE)
      throw new Error(t('There are no notes in Apple Notes on this Mac.'))
    throw new Error(message(error, t('Those notes could not be read.')))
  })
  const space = await workspace.addSpace('Apple Notes')
  if (!space) throw new Error(t('That import could not be written.'))
  await applyImport(plan, { root: space.root, folder: '' })
  await workspace.loadTree()
  await arrive(space)
  return true
}

export async function bringNotes(how: Bringing): Promise<Outcome> {
  const { onMac } = await import('../importing.svelte')
  return running(async () => {
    switch (how) {
      case 'vault':
        return landed(await vault())
      case 'folder':
        return landed(await folder())
      case 'files':
        return landed(await files())
      case 'apple':
        return onMac() ? macNotes() : landed(await folder())
    }
  })
}

export async function browsersHere(): Promise<Set<BrowserId | 'zen'>> {
  if (!isDesktop) return new Set()
  const [{ foundBrowsers }, { zenProfiles }] = await Promise.all([
    import('../import/browsers'),
    import('../import/zen-profiles'),
  ])
  const [found, zen] = await Promise.all([foundBrowsers(), zenProfiles()])
  const here = new Set<BrowserId | 'zen'>(found.map((one) => one.browser))
  if (zen.length) here.add('zen')
  return here
}

export async function bringBrowser(importer: BrowserId | 'zen'): Promise<string[]> {
  const { migrating } = await import('../migrating.svelte')
  const troubles: string[] = []
  const heard = () => {
    if (busy.trouble) troubles.push(busy.trouble)
  }

  if (importer === 'zen') {
    const { zenProfiles } = await import('../import/zen-landing')
    for (const profile of await zenProfiles()) {
      await migrating.zenProfile(profile)
      heard()
    }
    return troubles
  }

  const { foundBrowsers } = await import('../import/browsers')
  const found = (await foundBrowsers()).find((one) => one.browser === importer)
  const profiles = found?.profiles ?? []
  for (const profile of profiles) {
    await migrating.browserProfile(profile, profiles.length > 1)
    heard()
  }
  return troubles
}
