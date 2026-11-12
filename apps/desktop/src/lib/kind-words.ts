import { type KindName } from './settings.svelte'

export function kindLabel(kind: KindName): string {
  return {
    note: () => 'New note',
    canvas: () => 'New canvas',
    pages: () => 'New page note',
    chat: () => 'New chat',
    terminal: () => 'New terminal',
    remote: () => 'Remote',
    online: () => 'Online terminal',
    application: () => 'New application',
    explorer: () => 'File explorer',
    pass: () => 'Pass',
    web: () => 'New web note',
    private: () => 'New private tab',
  }[kind]()
}

export function kindName(kind: KindName): string {
  return {
    note: () => 'Note',
    canvas: () => 'Canvas',
    pages: () => 'Page note',
    chat: () => 'Chat',
    terminal: () => 'Terminal',
    remote: () => 'Remote',
    online: () => 'Online terminal',
    application: () => 'Application',
    explorer: () => 'File explorer',
    pass: () => 'Pass',
    web: () => 'Web note',
    private: () => 'Private tab',
  }[kind]()
}
