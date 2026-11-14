import type { PickedFile } from '@orden/contracts'
import { busy, message, viewport } from './ui-kit/src/api'
import { firstVisit } from './first-visit.svelte'
import type { FormatId } from './import/src/api'
import { type LinkFormat, linkWriting, setLinkWriting } from './link-format'
import {
  applyImport,
  carriedBy,
  detect,
  foundBrowsers,
  insideFolder,
  landBrowser,
  landZen,
  pickedFolder,
  readAs,
  type Source,
  sourcesFrom,
  vaults,
  vaultSources,
  zenProfiles,
} from './import/src/api'
import type { BrowserProfile, FoundBrowser } from './import/src/api'
import type { Vault } from './import/src/api'
import type { ZenProfile } from './import/src/api'
import { isDesktop } from './platform/src/api'
import { type Space, workspace } from './workspace.svelte'

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

  async folder() {
    const { pickFolder } = await import('./picking')
    const picked = await pickFolder()
    const name = pickedFolder(picked)
    if (!name) return

    await this.bringing(async () => ({ name, sources: await sourcesFrom(insideFolder(picked)) }))
  }

  async files() {
    const { pickFiles } = await import('./picking')
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

async function namedFor(picked: readonly PickedFile[], format: FormatId): Promise<string> {
  const { folderNameFor } = await import('./importing.svelte')
  return folderNameFor(picked, format)
}

export async function importAsSpace(
  name: string | ((format: FormatId) => Promise<string>),
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

  const space = await workspace.addSpace(typeof name === 'string' ? name : await name(format))
  if (!space) throw new Error('That import could not be written.')

  await applyImport(plan, { root: space.root, folder: '' })

  if (carried) {
    const { carryOver } = await import('./carry-over')
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
