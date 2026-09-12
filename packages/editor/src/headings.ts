/** Which syntax nodes are headings, and at what level.
 *
 *  Three walks over the tree ask: the live preview, to give the line its size;
 *  the table of contents, to list them; and the block handles, to know that a
 *  heading's block is its whole section. Each asked with a pattern of its own,
 *  and one of the three spelled it differently.
 *
 *  A table rather than a pattern because there are eight names and the walks ask
 *  about every node they meet - on every keystroke, over every visible line - so
 *  this was the most-run line in the preview. A lookup is not a match. */
export const HEADING_LEVEL: Readonly<Record<string, number>> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
  SetextHeading1: 1,
  SetextHeading2: 2,
}

/** Which level of heading a node's name says it is, or null when it is not one. */
export function headingLevel(name: string): number | null {
  return HEADING_LEVEL[name] ?? null
}

/** What words a heading line shows is @nib/markdown's, not the editor's: it is
 *  what decides what `[[Note#Heading]]` can name, so the editor writing such a
 *  link and the renderer resolving one have to read the line the same way. */
export { headingText } from '@nib/markdown/links'
