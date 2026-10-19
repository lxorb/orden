/** The version this app is, said in Settings > General > Updates and found in the Shift
 *  Shift search by "version" or "about", and copied with a press (#490).
 *
 *  Emil: *"can I somehow see the current version of orden currently?"* Only the macOS
 *  menu's About and an AI command said it; Windows, Linux, the phone and the web said it
 *  nowhere. Now every build does, beside the channel it follows where it follows one: a
 *  desktop the release channel chosen here, the web app the build it was served, and a
 *  phone none, its updates being the store's.
 *
 *  The version is `__APP_VERSION__`, the one the installer carries; see vite.config.ts. */

import { copyText } from '../clipboard'
import { t } from '../i18n.svelte'
import { isDesktop } from '../tauri'
import { webChannel } from '../updater'
import { updates } from '../updates.svelte'
import type { Field } from './fields'

/** How long the row says it copied: CopyButton's own while. */
const SAID_FOR = 1600

class Version {
  /** Whether the row is saying it just copied the version. */
  copied = $state(false)
  private saying: ReturnType<typeof setTimeout> | undefined

  /** The channel the version is on, in the words its own row uses, or null where there
   *  is none to follow. */
  channel(): string | null {
    const channel = isDesktop ? updates.channel : webChannel
    if (channel === null) return null
    return channel === 'unstable' ? t('Unstable') : t('Stable')
  }

  /** What the row says: the version, and the channel beside it. */
  said(): string {
    const channel = this.channel()
    return channel ? `${__APP_VERSION__} · ${channel}` : __APP_VERSION__
  }

  /** The version alone on the clipboard, and the row saying so for a moment. */
  async copy(): Promise<void> {
    await copyText(__APP_VERSION__)
    this.copied = true
    clearTimeout(this.saying)
    this.saying = setTimeout(() => (this.copied = false), SAID_FOR)
  }
}

export const version = new Version()

/** The row: read only, and a press copies it. */
export function versionField(): Field {
  return {
    kind: 'value',
    label: t('Version'),
    words: ['version', 'about', 'build', 'release', 'number', 'installed'],
    get: () => (version.copied ? t('Copied') : version.said()),
    press: () => void version.copy(),
  }
}
