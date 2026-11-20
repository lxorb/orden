import './shell-parts'
export { quickAdd } from './asked.svelte'
export const loadQuickAddSheet = () => import('./QuickAddSheet.svelte')
export const loadQuickAddWindow = () => import('./Window.svelte')
export const quickShortcuts = () => import('./shortcuts')
export const quickAnywhere = () => import('./anywhere.svelte')
