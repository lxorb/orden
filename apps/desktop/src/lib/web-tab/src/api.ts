import './shell-parts'
export { pages, siteMark } from './pages.svelte'
export type { Page, Step } from './pages.svelte'
export const loadWebTab = () => import('./WebTab.svelte')
export const loadPrivateMark = () => import('./PrivateMark.svelte')
export const webDownloads = () => import('./downloads.svelte')
export const siteDropping = () => import('./dropped-site')
export const privateWindows = () => import('./private')
export const siteIconSet = () => import('./site-icons.svelte')
export const pagesHanded = () => import('./handed')
export const webDataSheet = () => import('./own-data')
export const oneWindow = () => import('./one-window.svelte')
export const websiteConverting = () => import('./convert')
export const webLending = () => import('./lending')
export const webNotes = () => import('./note')
export const siteMaking = () => import('./new-site')
export const pageAiming = () => import('./aimed')
export const webDataStores = () => import('./web-data.svelte')
export const pageZoom = () => import('./zoom')
