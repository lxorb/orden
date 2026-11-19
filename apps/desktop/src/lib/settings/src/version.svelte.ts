import { Copied } from '../../ui-controls/src/api'
import { isDesktop } from '../../platform/src/api'
import { updates, webChannel } from '../../updates/src/api'
import type { Field } from './fields'

class Version {
  private readonly copying = new Copied()
  get copied(): boolean {
    return this.copying.what === true
  }
  channel(): string | null {
    const channel = isDesktop ? updates.channel : webChannel
    if (channel === null) return null
    return channel === 'unstable' ? 'Unstable' : 'Stable'
  }
  private which(): string {
    return webChannel !== null && __APP_COMMIT__ ? `${__APP_VERSION__} (${__APP_COMMIT__})` : __APP_VERSION__
  }
  said(): string {
    const channel = this.channel()
    return channel ? `${this.which()}, ${channel}` : this.which()
  }
  copy(): Promise<void> {
    return this.copying.copy(this.which(), true)
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
