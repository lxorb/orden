import { busy } from './busy.svelte'
import { firstVisit } from './first-visit.svelte'
import { message, t } from './i18n.svelte'
import { type FormatId, worthKnowing } from './import/plan'
import { type LinkFormat, linkWriting, setLinkWriting } from './link-format'
import { insideFolder, pickedFolder, sourcesFrom, type Picked, type Source } from './import/sources'
import type { BrowserProfile, FoundBrowser } from './import/browsers'
import type { Vault } from './import/vaults'
import type { ZenProfile } from './import/zen-profiles'
import { isDesktop } from './tauri'
import { viewport } from './viewport.svelte'
import { type Space, workspace } from './workspace.svelte'

class Migrating {
  working = $state(false)

  vaults = $state<Vault[] | null>(null)

  profiles = $state<ZenProfile[] | null>(null)

  browsers = $state<FoundBrowser[]>([])

  browserProfiles = $state<BrowserProfile[] | null>(null)

  async obsidian() {
    if (this.working) return
    const { vaults } = await import('./import/vaults')
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
    const { foundBrowsers } = await import('./import/browsers')
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
      const { landBrowser } = await import('./import/browser-landing')
      const space = await landBrowser(profile, several)
      this.browserProfiles = null
      await arrive(space, false)
    })
  }

  async zen() {
    if (this.working) return
    const { zenProfiles } = await import('./import/zen-landing')
    const found = await zenProfiles()
    const [only] = found
    if (found.length > 1) this.profiles = found
    else if (only) await this.zenProfile(only)
    else busy.failed(t('Zen’s tabs could not be read.'))
  }

  async zenProfile(profile: ZenProfile) {
    await this.running(async () => {
      const { landZen } = await import('./import/zen-landing')
      const space = await landZen(profile)
      this.profiles = null
      await arrive(space, false)
    })
  }

  async vault(vault: Vault) {
    await this.bringing(async () => {
      const { vaultSources } = await import('./import/vaults')
      return { name: vault.name, sources: await vaultSources(vault) }
    })
  }

  async folder() {
    const { pickFolder } = await import('./import/picking')
    const picked = await pickFolder()
    const name = pickedFolder(picked)
    if (!name) return

    await this.bringing(async () => ({ name, sources: await sourcesFrom(insideFolder(picked)) }))
  }

  async files() {
    const { pickFiles } = await import('./import/picking')
    const picked = await pickFiles()
    if (!picked.length) return

    await this.bringing(async () => ({
      name: (format) => namedFor(picked, format),
      sources: await sourcesFrom(picked),
    }))
  }

  private async bringing(
    read: () => Promise<{
      name: string | ((format: FormatId) => Promise<string>)
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
      await busy.run(t('Importing'), async () => {
        try {
          await task()
        } catch (error) {
          busy.failed(message(error, t('That import could not be written.')))
        }
      })
    } finally {
      this.working = false
    }
  }
}

async function namedFor(picked: readonly Picked[], format: FormatId): Promise<string> {
  const { folderNameFor } = await import('./importing.svelte')
  return folderNameFor(picked, format)
}

export async function importAsSpace(
  name: string | ((format: FormatId) => Promise<string>),
  sources: readonly Source[],
): Promise<Space> {
  const [{ detect, readAs }, { applyImport }, { carriedBy }] = await Promise.all([
    import('./import/read'),
    import('./import/apply'),
    import('./import/carry'),
  ])

  const format = await detect(sources)
  if (!format) throw new Error(t('Nothing in there can be read as notes.'))

  const carried = await carriedBy(format, sources)
  const plan = await spelledAs(carried?.linkFormat, () => readAs(format, sources))
  const shown = plan.files.some((one) => !one.path.split('/').some((part) => part.startsWith('.')))
  if (!shown) {
    const said = [t('Nothing in there can be read as notes.'), ...plan.lost.map(worthKnowing)]
    throw new Error(said.join(' '))
  }

  const space = await workspace.addSpace(typeof name === 'string' ? name : await name(format))
  if (!space) throw new Error(t('That import could not be written.'))

  await applyImport(plan, { root: space.root, folder: '' })

  if (carried) {
    const { carryOver } = await import('./carry-over')
    await carryOver(carried)
  }

  await workspace.loadTree()
  if (plan.lost.length) busy.failed(plan.lost.map(worthKnowing).join(' '))
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
