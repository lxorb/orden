import type { SettingsPartView } from '@orden/contracts'
import { mount, unmount } from 'svelte'
import ExtensionRows from './ExtensionRows.svelte'

export const extensionRows: SettingsPartView = {
  show: (target) => {
    if (!(target instanceof HTMLElement)) return () => undefined
    const rows = mount(ExtensionRows, { target })
    return () => void unmount(rows)
  },
}
