import './shell-parts'
export { pages, siteMark } from './pages.svelte'
export type { Page, Step } from './pages.svelte'

const away = <T>(): Promise<T> => new Promise<never>(() => undefined)

export const loadWebTab = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./WebTab.svelte')>() : import('./WebTab.svelte')

export const loadPrivateMark = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./PrivateMark.svelte')>() : import('./PrivateMark.svelte')

export const webDownloads = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./downloads.svelte')>() : import('./downloads.svelte')

export const siteDropping = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./dropped-site')>() : import('./dropped-site')

export const siteMuting = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./mute')>() : import('./mute')

export const siteClearing = () =>
  __EVEN_PLUGIN__
    ? away<typeof import('./clearing-asked.svelte')>()
    : import('./clearing-asked.svelte')

export const privateWindows = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./private')>() : import('./private')

export const historyOpening = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./history-open')>() : import('./history-open')

export const siteIconSet = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./site-icons.svelte')>() : import('./site-icons.svelte')

export const pagesHanded = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./handed')>() : import('./handed')

export const webDataSheet = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./own-data')>() : import('./own-data')

export const oneWindow = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./one-window.svelte')>() : import('./one-window.svelte')

export const websiteConverting = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./convert')>() : import('./convert')

export const webLending = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./lending')>() : import('./lending')

export const webNotes = () => (__EVEN_PLUGIN__ ? away<typeof import('./note')>() : import('./note'))

export const siteMaking = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./new-site')>() : import('./new-site')

export const pageAiming = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./aimed')>() : import('./aimed')

export const webDataStores = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./web-data.svelte')>() : import('./web-data.svelte')

export const pageZoom = () => (__EVEN_PLUGIN__ ? away<typeof import('./zoom')>() : import('./zoom'))
