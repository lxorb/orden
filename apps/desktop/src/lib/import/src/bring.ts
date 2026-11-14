import type { Importer, NotesBrought, NotesFrom } from '@orden/contracts'
import { busy, message } from '../../ui-kit/src/api'
import { isDesktop } from '../../platform/src/api'
import { foundBrowsers } from './browsers'
import { onMac } from './folder-name'
import { migrating } from './migrating.svelte'
import { zenProfiles } from './zen-profiles'

async function picked(how: NotesFrom): Promise<boolean> {
  switch (how) {
    case 'vault':
      return migrating.onlyVault()
    case 'folder':
      return migrating.folder()
    case 'files':
      return migrating.files()
    case 'apple':
      if (!onMac()) return migrating.folder()
      await migrating.appleNotes()
      return true
  }
}

export async function notes(how: NotesFrom): Promise<NotesBrought> {
  try {
    return { picked: await picked(how), trouble: busy.trouble }
  } catch (error) {
    return { picked: true, trouble: message(error, 'That import could not be written.') }
  }
}

export async function here(): Promise<ReadonlySet<Importer>> {
  if (!isDesktop) return new Set()
  const [found, zen] = await Promise.all([foundBrowsers(), zenProfiles()])
  const ids = new Set<Importer>(found.map((one) => one.browser))
  if (zen.length) ids.add('zen')
  return ids
}

export async function browser(importer: Importer): Promise<string[]> {
  const troubles: string[] = []
  const heard = () => {
    if (busy.trouble) troubles.push(busy.trouble)
  }

  if (importer === 'zen') {
    for (const profile of await zenProfiles()) {
      await migrating.zenProfile(profile)
      heard()
    }
    return troubles
  }

  const found = (await foundBrowsers()).find((one) => one.browser === importer)
  const profiles = found?.profiles ?? []
  for (const profile of profiles) {
    await migrating.browserProfile(profile, profiles.length > 1)
    heard()
  }
  return troubles
}
