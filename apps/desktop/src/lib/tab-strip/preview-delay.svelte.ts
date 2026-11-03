/** How long a tab is rested on before its card comes (#1088): a setting, Tabs in
 *  General, from at once to two seconds.
 *
 *  It was Chrome's wait, which grows with the width of the tabs from 300 ms to 1.3 s -
 *  long enough on a strip of a few wide tabs that the card felt as if it had not
 *  noticed. Half a second is Firefox's for a tooltip, which is what a tab's card is to
 *  a hand, and it is the same on every strip. Kept on this device through stored.ts. */

import { keep, storedText } from '../stored'

const KEY = 'nib:tab-preview-delay'

/** Half a second, Firefox's, and the dial's ends and step. */
export const PREVIEW_DELAY = { initial: 500, least: 0, most: 2000, step: 100 } as const

/** A delay as written, held to the dial: anything else is the default. */
function readDelay(text: string | null): number {
  const value = text === null ? Number.NaN : Number(text)
  if (!Number.isFinite(value)) return PREVIEW_DELAY.initial
  return Math.min(PREVIEW_DELAY.most, Math.max(PREVIEW_DELAY.least, Math.round(value)))
}

class PreviewDelay {
  ms = $state(readDelay(storedText(KEY)))

  set(value: number) {
    this.ms = readDelay(String(value))
    keep(KEY, String(this.ms))
  }
}

export const previewDelay = new PreviewDelay()
