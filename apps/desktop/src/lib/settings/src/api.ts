import './shell-parts'
export { clipboardSharing } from './apps-clipboard.svelte'
export type { Field, PairField, SwatchOption } from './fields'

export const loadSettingsPanel = () => import('./SettingsPanel.svelte')

export const settingDeclarations = () => import('./declarations')

export const settingSchema = () => import('./schema')
