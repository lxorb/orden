import { copyText } from '../../ui-controls/src/api'
import { DIVIDER, type MenuEntry } from '../../menu.svelte'
import { shortcuts } from '../../shortcuts.svelte'
import { openExternal } from '../../platform/src/api'
import { isWebAddress } from '@orden/scan/web-address'
import type { Page } from './pages.svelte'

export const ZOOMS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5,
]

const SMALLEST = ZOOMS[0] ?? 0.25
const LARGEST = ZOOMS[ZOOMS.length - 1] ?? 5

export function zoomed(from: number, up: boolean): number {
  const steps = up ? ZOOMS : [...ZOOMS].reverse()
  return steps.find((one) => (up ? one > from + 0.001 : one < from - 0.001)) ?? from
}

const MOST_STEPS = 12

export function trailSteps(
  urls: readonly string[],
  at: number,
  forward: boolean,
): { url: string; by: number }[] {
  const steps: { url: string; by: number }[] = []
  for (let by = 1; by <= MOST_STEPS; by++) {
    const url = urls[forward ? at + by : at - by]
    if (url === undefined) break
    steps.push({ url, by })
  }
  return steps
}

export interface WebActions {
  newTab: () => void
  newPrivate?: (() => void) | undefined
  history: () => void
  clearData: () => void
  bookmarks: () => void
  zoom: (factor: number) => void
  fullScreen: () => void
  print: () => void
  find?: (() => void) | undefined
  save: () => void
  share: () => void
  settings: () => void
}

export function webRows(page: Page, zoom: number, actions: WebActions): MenuEntry[] {
  const url = page.url
  const has = url !== null && isWebAddress(url)

  return [
    { label: 'New tab', run: actions.newTab },
    ...(actions.newPrivate
      ? [
          {
            label: 'New private tab',
            hint: shortcuts.hint('app.new-private'),
            run: actions.newPrivate,
          },
        ]
      : []),
    DIVIDER,
    { label: 'History', hint: shortcuts.hint('web.history'), run: actions.history },
    { label: 'Essentials', run: actions.bookmarks },
    {
      label: 'Delete browsing data…',
      hint: shortcuts.hint('web.clear-data'),
      run: actions.clearData,
    },
    DIVIDER,
    {
      label: 'Zoom out',
      disabled: !has || zoom <= SMALLEST,
      keep: true,
      run: () => actions.zoom(zoomed(zoom, false)),
    },
    {
      label: `${Math.round(zoom * 100)}%`,
      disabled: !has,
      keep: true,
      run: () => actions.zoom(1),
    },
    {
      label: 'Zoom in',
      disabled: !has || zoom >= LARGEST,
      keep: true,
      run: () => actions.zoom(zoomed(zoom, true)),
    },
    { label: 'Full screen', run: actions.fullScreen },
    DIVIDER,
    { label: 'Print…', disabled: !has, run: actions.print },
    ...(actions.find
      ? [{ label: 'Find', hint: shortcuts.hint('edit.find'), disabled: !has, run: actions.find }]
      : []),
    DIVIDER,
    { label: 'Save as a note', disabled: !has, run: actions.save },
    { label: 'Share…', disabled: !has, run: actions.share },
    {
      label: 'Copy link',
      disabled: !has,
      run: () => {
        if (url !== null) void copyText(url)
      },
    },
    { label: 'Open in the browser', disabled: !has, run: () => void openExternal(url ?? '') },
    DIVIDER,
    { label: 'Settings', run: actions.settings },
  ]
}
