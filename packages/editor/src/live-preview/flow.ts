/** What a ` ```flow ` fence may make flowchart.js do.
 *
 *  The fence is the note's words, and flowchart.js reads two things out of those
 *  words that are not a picture: `:>address` makes a box a link to the address,
 *  and `:$name` makes a press on a box call the window global of that name. Both
 *  reach the drawing without anything in between asking whether the note is
 *  trusted - the link straight into an `href`, past every check a link in a note
 *  goes through - so the hook is taken out of the source before it is parsed, and
 *  a link that points where no link in a note may is taken off the drawing after.
 *  The live preview and an export both draw through here, so the two cannot
 *  disagree about what a fence may do. */

import { safeHref } from '@nib/markdown/html'

/** The source with every `:$hook` taken out of it.
 *
 *  A hook runs to the end of its line, the way flowchart.js reads one; the box
 *  keeps its words and loses the call. Nothing a diagram draws needs one. */
export function flowSource(code: string): string {
  return code.replace(/:\$[^\n]*/g, '')
}

/** Takes every link off a drawing that points where a link in a note may not:
 *  `javascript:` and the rest of what `safeHref` refuses. The box stays, and
 *  pressing it does nothing. */
export function keepSafeLinks(root: Element): void {
  // Every element rather than a selector for the attribute: Raphaël writes the
  // link as `xlink:href` in some engines and as `href` in others.
  for (const node of root.querySelectorAll('*')) {
    for (const attribute of [...node.attributes]) {
      if (attribute.localName === 'href' && !safeHref(attribute.value)) {
        node.removeAttributeNode(attribute)
      }
    }
  }
}
