import './shell-parts'
export { settings } from './window.svelte'
export { clipboardSharing } from './apps-clipboard.svelte'
export type { Field } from './fields'

export const loadSettingsPanel = () => import('./SettingsPanel.svelte')

export const settingDeclarations = () => import('./declarations')

export const settingSchema = () => import('./schema')
