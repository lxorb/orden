import { copyText } from '../clipboard'
import { isDesktop } from '../platform/src/api'
import { webChannel } from '../updater'
import { updates } from '../updates.svelte'
import type { Field } from './fields'

const SAID_FOR = 1600

class Version {
  copied = $state(false)
  private saying: ReturnType<typeof setTimeout> | undefined

  channel(): string | null {
    const channel = isDesktop ? updates.channel : webChannel
    if (channel === null) return null
    return channel === 'unstable' ? 'Unstable' : 'Stable'
  }

  private which(): string {
    return webChannel !== null && __APP_COMMIT__
      ? `${__APP_VERSION__} (${__APP_COMMIT__})`
      : __APP_VERSION__
  }

  said(): string {
    const channel = this.channel()
    return channel ? `${this.which()}, ${channel}` : this.which()
  }

  async copy(): Promise<void> {
    await copyText(this.which())
    this.copied = true
    clearTimeout(this.saying)
    this.saying = setTimeout(() => (this.copied = false), SAID_FOR)
  }
}

export const version = new Version()

export function versionField(): Field {
  return {
    kind: 'value',
    label: 'Version',
    hint: 'The version of Orden that is running; press to copy it.',
    words: ['version', 'about', 'build', 'release', 'number', 'installed'],
    get: () => (version.copied ? 'Copied' : version.said()),
    does: 'Copy',
    press: () => void version.copy(),
  }
}
