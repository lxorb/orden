/** The version this app is, said in Settings > General > Updates and found in the Shift
 *  Shift search by "version" or "about", and copied with a press (#490).
 *
 *  Emil: *"can I somehow see the current version of orden currently?"* Only the macOS
 *  menu's About and an AI command said it; Windows, Linux, the phone and the web said it
 *  nowhere. Now every build does, beside the channel it follows where it follows one: a
 *  desktop the release channel chosen here, the web app the build it was served, and a
 *  phone none, its updates being the store's.
 *
 *  The version is `__APP_VERSION__`, the one the installer carries; see vite.config.ts.
 *
 *  The web app says its commit after it as well (#1112). Every web build of a release
 *  carries the release's number, and so does the edge of `unstable` the Worker serves
 *  beside it, which had stood a week behind `unstable` with nothing anywhere to tell. A
 *  desktop's number already names its build (scripts/build-version.sh), and a phone's
 *  is the store's. */

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

  /** The version, and on the web the commit it was built from. */
  private which(): string {
    return webChannel !== null && __APP_COMMIT__
      ? `${__APP_VERSION__} (${__APP_COMMIT__})`
      : __APP_VERSION__
  }

  /** What the row says: the version, and the channel beside it. */
  said(): string {
    const channel = this.channel()
    return channel ? `${this.which()} · ${channel}` : this.which()
  }

  /** The version alone on the clipboard, its commit with it on the web, and the row
   *  saying so for a moment. */
  async copy(): Promise<void> {
    await copyText(this.which())
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
    hint: t('The version of Orden that is running; press to copy it.'),
    words: ['version', 'about', 'build', 'release', 'number', 'installed'],
    get: () => (version.copied ? t('Copied') : version.said()),
    press: () => void version.copy(),
  }
}
