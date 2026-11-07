import { type KindName } from './settings.svelte'
import { t } from './i18n.svelte'

export function kindLabel(kind: KindName): string {
  return {
    note: () => t('New note'),
    canvas: () => t('New canvas'),
    pages: () => t('New page note'),
    chat: () => t('New chat'),
    terminal: () => t('New terminal'),
    remote: () => t('Remote'),
    online: () => t('Online terminal'),
    application: () => t('New application'),
    explorer: () => t('File explorer'),
    pass: () => t('Pass'),
    web: () => t('New web note'),
    private: () => t('New private tab'),
  }[kind]()
}

export function kindName(kind: KindName): string {
  return {
    note: () => t('Note'),
    canvas: () => t('Canvas'),
    pages: () => t('Page note'),
    chat: () => t('Chat'),
    terminal: () => t('Terminal'),
    remote: () => t('Remote'),
    online: () => t('Online terminal'),
    application: () => t('Application'),
    explorer: () => t('File explorer'),
    pass: () => t('Pass'),
    web: () => t('Web note'),
    private: () => t('Private tab'),
  }[kind]()
}
