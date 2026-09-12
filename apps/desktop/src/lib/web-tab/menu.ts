/** The rows behind the dots on a web tab's bar.
 *
 *  What a browser keeps in the same place, and nothing it does not: where to send
 *  the page, what to copy, what this site may do, and the clip the glyph beside it
 *  performs. Built here rather than in the bar so the bar stays a row of controls,
 *  and read by the same context menu every other list in the app opens; see
 *  menu.svelte.ts. */

import { copyText } from '../clipboard'
import { t } from '../i18n.svelte'
import { DIVIDER, type MenuEntry } from '../menu.svelte'
import { openExternal } from '../tauri'
import type { Page } from './pages.svelte'
import { type Grant, grants, siteOf } from './permissions.svelte'

/** What each grant is called on the row that gives it.
 *
 *  The camera stands for the microphone, because they are one thing to a browser and
 *  one thing to a reader deciding: a page that may watch you may listen to you. */
const NAMES: Record<Grant, () => string> = {
  camera: () => t('Allow the camera'),
  clipboard: () => t('Allow the clipboard'),
}

export function webRows(page: Page, onclip: () => void): MenuEntry[] {
  const url = page.url
  const site = siteOf(url)

  const permissions: MenuEntry[] = site
    ? [
        DIVIDER,
        ...(Object.keys(NAMES) as Grant[]).map((grant) => ({
          label: NAMES[grant](),
          run: () => grants.set(site, grant, !grants.has(site, grant)),
          // A tick is what a menu has for a thing that is on, and the menu draws
          // one from `danger`'s neighbour: there is none, so the words carry it -
          // a grant that is on reads "Allow" with the site already allowed, which
          // is why the row says what pressing it will do rather than what is.
          hint: grants.has(site, grant) ? t('On') : undefined,
        })),
      ]
    : []

  return [
    {
      label: t('Open in the browser'),
      disabled: url === null,
      run: () => {
        if (url !== null) void openExternal(url)
      },
    },
    {
      label: t('Copy the address'),
      disabled: url === null,
      run: () => {
        if (url !== null) void copyText(url)
      },
    },
    DIVIDER,
    { label: t('Clip this page'), disabled: url === null, run: onclip },
    ...permissions,
  ]
}
