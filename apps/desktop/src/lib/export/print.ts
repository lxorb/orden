/** The note on paper, through whatever print dialog the machine has.
 *
 *  The same page an HTML export writes and the reading view shows, handed to the
 *  print engine of the webview it is already running in: one renderer, so what
 *  comes off the printer is what was on the screen, page breaks and paper size
 *  included. Nothing is written to disk - "Save as PDF" is a row inside the
 *  system's own dialog, and the app's PDF export is the row for anybody who wants
 *  the file itself.
 *
 *  Always the light scheme: it is going on paper, and a dark page costs a
 *  cartridge. */

import { openTarget, renderOptions } from './context'

/** Whether this build has a print dialog to open at all. A desktop and a browser
 *  do; a phone's webview may or may not, and the row is left out where it does
 *  not - a menu row that does nothing is worse than no row. */
export const canPrint = typeof window !== 'undefined' && typeof window.print === 'function'

export async function printNote(): Promise<void> {
  // Asked for when somebody prints rather than at startup: the renderer carries the
  // diagram drawers, the syntax parsers and the fonts, which is most of what the app
  // can load, and the row that offers printing is a word.
  const { printInFrame, renderNote } = await import('../export')

  const target = openTarget()
  const options = await renderOptions(target)
  const html = await renderNote(target.source, target.name, { ...options, scheme: 'light' })

  await printInFrame(html)
}
