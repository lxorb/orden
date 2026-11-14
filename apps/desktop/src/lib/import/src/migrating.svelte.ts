import { busy, message, viewport } from '../../ui-kit/src/api'
import { firstVisit } from '../../first-visit.svelte'
import { type LinkFormat, linkWriting, setLinkWriting } from '../../link-format'
import { isDesktop } from '../../platform/src/api'
import { type Space, workspace } from '../../workspace.svelte'
import { applyImport } from './apply'
import { landBrowser } from './browser-landing'
import { type BrowserProfile, type FoundBrowser, foundBrowsers } from './browsers'
import { carriedBy } from './carry'
import { folderNameFor } from './folder-name'
import type { FormatId } from './plan'
import { detect, readAs } from './read'
import { insideFolder, pickedFolder, type Source, sourcesFrom } from './sources'
import { type Vault, vaults, vaultSources } from './vaults'
import { landZen } from './zen-landing'
import { type ZenProfile, zenProfiles } from './zen-profiles'

class Migrating {
  working = $state(false)

  vaults = $state<Vault[] | null>(null)

  profiles = $state<ZenProfile[] | null>(null)

  browsers = $state<FoundBrowser[]>([])

  browserProfiles = $state<BrowserProfile[] | null>(null)

  async obsidian() {
    if (this.working) return
    const found = isDesktop ? await vaults() : []
    if (found.length) this.vaults = found
    else await this.folder()
  }

  back() {
    this.vaults = null
    this.profiles = null
    this.browserProfiles = null
  }

  async findBrowsers() {
    if (!isDesktop) return
    this.browsers = await foundBrowsers()
  }

  async browser(found: FoundBrowser) {
    if (this.working) return
    const [only] = found.profiles
    if (found.profiles.length > 1) this.browserProfiles = found.profiles
    else if (only) await this.browserProfile(only, false)
  }

  async browserProfile(profile: BrowserProfile, several = true) {
    await this.running(async () => {
      const space = await landBrowser(profile, several)
      this.browserProfiles = null
      await arrive(space, false)
    })
  }

  async zen() {
    if (this.working) return
    const found = await zenProfiles()
    const [only] = found
    if (found.length > 1) this.profiles = found
    else if (only) await this.zenProfile(only)
    else busy.failed('Zen’s tabs could not be read.')
  }

  async zenProfile(profile: ZenProfile) {
    await this.running(async () => {
      const space = await landZen(profile)
      this.profiles = null
      await arrive(space, false)
    })
  }

  async vault(vault: Vault) {
    await this.bringing(async () => {
      return { name: vault.name, sources: await vaultSources(vault) }
    })
  }

  async onlyVault(): Promise<boolean> {
    const found = isDesktop ? await vaults() : []
    const [only] = found
    if (found.length !== 1 || !only) return this.folder()
    await this.vault(only)
    return true
  }

  async folder(): Promise<boolean> {
    const { pickFolder } = await import('../../picking')
    const picked = await pickFolder()
    const name = pickedFolder(picked)
    if (!name) return false

    await this.bringing(async () => ({ name, sources: await sourcesFrom(insideFolder(picked)) }))
    return true
  }

  async files(): Promise<boolean> {
    const { pickFiles } = await import('../../picking')
    const picked = await pickFiles()
    if (!picked.length) return false

    await this.bringing(async () => ({
      name: (format) => folderNameFor(picked, format),
      sources: await sourcesFrom(picked),
    }))
    return true
  }

  async appleNotes() {
    await this.running(async () => {
      const apple = await import('./apple')
      const plan = await apple.readMacNotes().catch((error: unknown) => {
        throw new Error(apple.notesFault(error).said)
      })
      const space = await workspace.addSpace('Apple Notes')
      if (!space) throw new Error('That import could not be written.')
      await applyImport(plan, { root: space.root, folder: '' })
      await workspace.loadTree()
      await arrive(space)
    })
  }

  private async bringing(
    read: () => Promise<{
      name: string | ((format: FormatId) => string)
      sources: Source[]
    }>,
  ) {
    await this.running(async () => {
      const { name, sources } = await read()
      const space = await importAsSpace(name, sources)
      this.vaults = null
      await arrive(space)
    })
  }

  private async running(task: () => Promise<void>) {
    if (this.working) return
    this.working = true

    try {
      await busy.run('Importing', async () => {
        try {
          await task()
        } catch (error) {
          busy.failed(message(error, 'That import could not be written.'))
        }
      })
    } finally {
      this.working = false
    }
  }
}

export async function importAsSpace(
  name: string | ((format: FormatId) => string),
  sources: readonly Source[],
): Promise<Space> {
  const format = await detect(sources)
  if (!format) throw new Error('Nothing in there can be read as notes.')

  const carried = await carriedBy(format, sources)
  const plan = await spelledAs(carried?.linkFormat, () => readAs(format, sources))
  const shown = plan.files.some((one) => !one.path.split('/').some((part) => part.startsWith('.')))
  if (!shown) {
    const said = ['Nothing in there can be read as notes.', ...plan.lost]
    throw new Error(said.join(' '))
  }

  const space = await workspace.addSpace(typeof name === 'string' ? name : name(format))
  if (!space) throw new Error('That import could not be written.')

  await applyImport(plan, { root: space.root, folder: '' })

  if (carried) {
    const { carryOver } = await import('../../carry-over')
    await carryOver(carried)
  }

  await workspace.loadTree()
  if (plan.lost.length) busy.failed(plan.lost.join(' '))
  return space
}

async function spelledAs<T>(format: LinkFormat | undefined, read: () => Promise<T>): Promise<T> {
  if (!format) return read()

  const was = linkWriting()
  setLinkWriting(format)
  try {
    return await read()
  } finally {
    setLinkWriting(was)
  }
}

export async function arrive(space: Space, open = true) {
  if (firstVisit.fresh) firstVisit.answered()
  if (workspace.activeSpaceId !== space.id) await workspace.showSpace(space.id)
  const note = open ? firstNote() : null
  if (note) await workspace.openEntry(note, { activate: true })
  if (!viewport.drawer) workspace.showPanel('tree')
}

function firstNote(): string | null {
  return (workspace.notes[0] ?? workspace.files[0])?.path ?? null
}

export const migrating = new Migrating()
