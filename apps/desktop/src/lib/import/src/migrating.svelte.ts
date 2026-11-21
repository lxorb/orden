import { busy, message } from '../../ui-kit/src/api'
import { isDesktop } from '../../platform/src/api'
import { arrive } from './arrive'
import { landBrowser } from './browser-landing'
import { type BrowserProfile, type FoundBrowser, foundBrowsers } from './browsers'
import { folderNameFor } from './folder-name'
import { type Bring, startImport } from './run.svelte'
import { insideFolder, pickedFolder, sourcesFrom } from './sources'
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
    await this.bringing({
      name: vault.name,
      label: `my Obsidian vault “${vault.name}”`,
      where: vault.path,
      read: async () => ({ sources: await vaultSources(vault) }),
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
    const { pickFolder } = await import('../../ui-controls/src/api')
    const picked = await pickFolder()
    const name = pickedFolder(picked)
    if (!name) return false
    await this.bringing({
      name,
      label: `the folder “${name}”`,
      read: async () => ({ sources: await sourcesFrom(insideFolder(picked)) }),
    })
    return true
  }
  async files(): Promise<boolean> {
    const { pickFiles } = await import('../../ui-controls/src/api')
    const picked = await pickFiles()
    if (!picked.length) return false
    const [first] = picked
    await this.bringing({
      name: (format) => folderNameFor(picked, format),
      label: picked.length === 1 && first ? `“${first.name}”` : `${String(picked.length)} files`,
      read: async () => ({ sources: await sourcesFrom(picked) }),
    })
    return true
  }
  async appleNotes() {
    await this.bringing({
      name: 'Apple Notes',
      label: 'my notes in Apple Notes',
      read: async () => {
        const apple = await import('./apple')
        const plan = await apple.readMacNotes().catch((error: unknown) => {
          const fault = apple.notesFault(error)
          throw Object.assign(new Error(fault.said), { noAccess: fault.noAccess })
        })
        return { plan }
      },
    })
  }
  private async bringing(bring: Bring) {
    if (this.working) return
    this.working = true
    this.vaults = null
    try {
      await startImport(bring)
    } finally {
      this.working = false
    }
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
export const migrating = new Migrating()
