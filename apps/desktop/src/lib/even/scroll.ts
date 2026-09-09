/** Who scrolls the note: the app, or the glasses.
 *
 *  - `paged` is what the plugin has always done. The app cuts the note into pages
 *    of exactly seven lines, sends one, and a flick of a temple sends the next.
 *    Every page is one send of about 83 ms and the panel never wraps a line the
 *    app did not wrap, so what is on the glass is what the app decided it is.
 *  - `native` hands the whole note over as one text container and lets the
 *    firmware scroll it. One send for the note rather than one per page, and the
 *    scrolling is the firmware's own, which is smoother than a radio can be - at
 *    the price of the app no longer knowing which words are in front of the
 *    reader, because nothing in the SDK reports an offset back. The frame on the
 *    phone then marks the page-sized window at the last place the app knows of.
 *
 *  A tiny module of its own because both the settings and the store need the
 *  answer and neither should reach into the other; the same reason `plugin.ts` is
 *  one line. */

export const SCROLLS = ['paged', 'native'] as const
export type Scroll = (typeof SCROLLS)[number]

export function isScroll(value: unknown): value is Scroll {
  return typeof value === 'string' && (SCROLLS as readonly string[]).includes(value)
}
